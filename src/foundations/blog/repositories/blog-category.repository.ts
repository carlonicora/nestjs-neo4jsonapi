import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { buildFulltextTerm } from "../../../core/neo4j/helpers/build-fulltext-term";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { BlogCategory, BlogCategoryDescriptor } from "../entities/blog-category";
import { blogCategoryMeta } from "../entities/blog-category.meta";
import { BlogCategoryTranslationDescriptor } from "../entities/blog-category-translation";
import { blogCategoryTranslationMeta } from "../entities/blog-category-translation.meta";

const category = blogCategoryMeta.nodeName;
const categoryLabel = blogCategoryMeta.labelName;
const translationLabel = blogCategoryTranslationMeta.labelName;

@Injectable()
export class BlogCategoryRepository extends AbstractRepository<
  BlogCategory,
  typeof BlogCategoryDescriptor.relationships
> {
  protected readonly descriptor = BlogCategoryDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Admin list. A category has no text of its own (name and description live
   * on its translations), so the inherited find would ignore `term`: a search
   * matches any language version through the translation full-text index.
   */
  async find(
    params: Parameters<AbstractRepository<BlogCategory, typeof BlogCategoryDescriptor.relationships>["find"]>[0],
  ) {
    if (!params.term) return super.find(params);

    const query = this.neo4j.initQuery({
      cursor: params.cursor,
      serialiser: BlogCategoryDescriptor.model,
      fetchAll: params.fetchAll,
    });
    query.queryParams = { ...query.queryParams, term: buildFulltextTerm(params.term) };
    query.query += `
      CALL db.index.fulltext.queryNodes("${BlogCategoryTranslationDescriptor.fulltextIndexName}", $term) YIELD node, score
      MATCH (${category}:${categoryLabel})-[:HAS_TRANSLATION]->(node)
      WITH ${category}, max(score) AS score
      CALL {
        WITH ${category}
        ${this.buildDefaultMatch()}
        RETURN true AS ${category}_fulltextAccess
        LIMIT 1
      }
      WITH ${category}, score
      ORDER BY score DESC
      {CURSOR}
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  async createWithOriginal(params: {
    id: string;
    originalLanguage: string;
    image?: string;
    translation: { id: string; name: string; slug: string; description?: string };
  }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          CREATE (${category}:${categoryLabel} {
            id: $id,
            originalLanguage: $originalLanguage,
            image: $image,
            createdAt: datetime(),
            updatedAt: datetime()
          })
          CREATE (translation:${translationLabel} {
            id: $translationId,
            language: $originalLanguage,
            isOriginal: true,
            source: $source,
            aiStatus: $aiStatus,
            name: $name,
            slug: $slug,
            description: $description,
            createdAt: datetime(),
            updatedAt: datetime()
          })
          CREATE (${category})-[:HAS_TRANSLATION]->(translation)
        `,
        params: {
          id: params.id,
          originalLanguage: params.originalLanguage,
          image: params.image ?? null,
          translationId: params.translation.id,
          source: "original",
          aiStatus: AiStatus.Completed,
          name: params.translation.name,
          slug: params.translation.slug,
          description: params.translation.description ?? null,
        },
      },
    ]);
  }

  /**
   * Full update of the language-independent fields: a missing image clears it.
   */
  async updateShared(params: { id: string; image?: string }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (${category}:${categoryLabel} {id: $id})
          SET ${category}.image = $image, ${category}.updatedAt = datetime()
        `,
        params: { id: params.id, image: params.image ?? null },
      },
    ]);
  }

  /**
   * Deletes the category, its translations and its post edges. Posts stay.
   */
  async deleteWithTranslations(params: { id: string }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (${category}:${categoryLabel} {id: $id})
          OPTIONAL MATCH (${category})-[:HAS_TRANSLATION]->(translation:${translationLabel})
          WITH ${category}, collect(translation) AS translations
          FOREACH (item IN translations | DETACH DELETE item)
          DETACH DELETE ${category}
        `,
        params: { id: params.id },
      },
    ]);
  }

  /**
   * Every category with its text in $language (completed translation, otherwise the original),
   * ordered by name. Unpaginated by design: the category set is small and bounded.
   */
  async findPublicList(params: { language: string }): Promise<BlogCategory[]> {
    const query = this.neo4j.initQuery({ serialiser: BlogCategoryDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      language: params.language,
      completedStatus: AiStatus.Completed,
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WITH ${category},
        head([(${category})-[:HAS_TRANSLATION]->(localised:${translationLabel}) WHERE localised.language = $language AND localised.aiStatus = $completedStatus | localised]) AS localised
      WITH ${category},
        coalesce(localised, head([(${category})-[:HAS_TRANSLATION]->(original:${translationLabel}) WHERE original.isOriginal = true | original])) AS t
      WITH ${category}, t
      ORDER BY toLower(t.name) ASC
      RETURN ${category},
        t.language AS resolvedLanguage,
        t.name AS resolvedName,
        t.slug AS resolvedSlug,
        t.description AS resolvedDescription
    `;

    return this.neo4j.readMany(query);
  }
}
