import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { buildFulltextTerm } from "../../../core/neo4j/helpers/build-fulltext-term";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { userMeta } from "../../user/entities/user.meta";
import { BlogPostStatus } from "../blog.constants";
import { blogCategoryMeta } from "../entities/blog-category.meta";
import { blogCategoryTranslationMeta } from "../entities/blog-category-translation.meta";
import { BlogPost, BlogPostDescriptor } from "../entities/blog-post";
import { blogPostMeta } from "../entities/blog-post.meta";
import { BlogPostTranslationDescriptor } from "../entities/blog-post-translation";
import { blogPostTranslationMeta } from "../entities/blog-post-translation.meta";

const post = blogPostMeta.nodeName;
const postLabel = blogPostMeta.labelName;
const translationLabel = blogPostTranslationMeta.labelName;
const categoryLabel = blogCategoryMeta.labelName;
const categoryTranslationLabel = blogCategoryTranslationMeta.labelName;

@Injectable()
export class BlogPostRepository extends AbstractRepository<BlogPost, typeof BlogPostDescriptor.relationships> {
  protected readonly descriptor = BlogPostDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Admin list. A post has no text of its own (every string lives on its
   * translations), so the inherited find would ignore `term`: a search matches
   * any language version through the translation full-text index instead.
   */
  async find(params: Parameters<AbstractRepository<BlogPost, typeof BlogPostDescriptor.relationships>["find"]>[0]) {
    if (!params.term) return super.find(params);

    const query = this.neo4j.initQuery({
      cursor: params.cursor,
      serialiser: BlogPostDescriptor.model,
      fetchAll: params.fetchAll,
    });
    query.queryParams = { ...query.queryParams, term: buildFulltextTerm(params.term) };
    query.query += `
      CALL db.index.fulltext.queryNodes("${BlogPostTranslationDescriptor.fulltextIndexName}", $term) YIELD node, score
      MATCH (${post}:${postLabel})-[:HAS_TRANSLATION]->(node)
      WITH ${post}, max(score) AS score
      CALL {
        WITH ${post}
        ${this.buildDefaultMatch()}
        RETURN true AS ${post}_fulltextAccess
        LIMIT 1
      }
      WITH ${post}, score
      ORDER BY score DESC
      {CURSOR}
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * Resolves the translation a visitor reads into `t`: the translation in $language when its
   * AI status is completed, otherwise the original. Pattern comprehensions, so the row count
   * (and the ORDER BY applied later) never changes.
   */
  private buildResolvedTranslation(carry: string[] = []): string {
    const carried = [post, ...carry].join(", ");
    return `
      WITH ${carried},
        head([(${post})-[:HAS_TRANSLATION]->(localised:${translationLabel}) WHERE localised.language = $language AND localised.aiStatus = $completedStatus | localised]) AS localised
      WITH ${carried},
        coalesce(localised, head([(${post})-[:HAS_TRANSLATION]->(original:${translationLabel}) WHERE original.isOriginal = true | original])) AS t
    `;
  }

  /**
   * Public RETURN: the post node plus the resolved-language columns read by the descriptor's
   * computed fields. Never returns the author User node (no email leak) nor translation nodes.
   */
  private buildPublicReturn(params: { includeBody: boolean }): string {
    return `
      RETURN ${post},
        t.language AS resolvedLanguage,
        t.title AS resolvedTitle,
        t.slug AS resolvedSlug,
        t.summary AS resolvedSummary,
        ${params.includeBody ? "t.body AS resolvedBody," : ""}
        t.coverImageAlt AS resolvedCoverImageAlt,
        t.readingMinutes AS resolvedReadingMinutes,
        head([(${post})<-[:AUTHORED]-(writer:${userMeta.labelName}) | writer.name]) AS authorName,
        [(${post})-[:IN_BLOG_CATEGORY]->(postCategory:${categoryLabel}) | postCategory.id] AS categoryIds
    `;
  }

  async createWithOriginal(params: {
    id: string;
    authorId: string;
    originalLanguage: string;
    coverImage?: string;
    categoryIds: string[];
    translation: {
      id: string;
      title: string;
      slug: string;
      summary?: string;
      body: string;
      bodyText: string;
      coverImageAlt?: string;
      readingMinutes: number;
    };
  }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (author:${userMeta.labelName} {id: $authorId})
          CREATE (${post}:${postLabel} {
            id: $id,
            status: $status,
            originalLanguage: $originalLanguage,
            coverImage: $coverImage,
            createdAt: datetime(),
            updatedAt: datetime()
          })
          CREATE (author)-[:AUTHORED]->(${post})
        `,
        params: {
          id: params.id,
          authorId: params.authorId,
          status: "draft",
          originalLanguage: params.originalLanguage,
          coverImage: params.coverImage ?? null,
        },
      },
      {
        query: `
          MATCH (${post}:${postLabel} {id: $id})
          CREATE (translation:${translationLabel} {
            id: $translationId,
            language: $originalLanguage,
            isOriginal: true,
            source: $source,
            aiStatus: $aiStatus,
            title: $title,
            slug: $slug,
            summary: $summary,
            body: $body,
            bodyText: $bodyText,
            coverImageAlt: $coverImageAlt,
            readingMinutes: $readingMinutes,
            createdAt: datetime(),
            updatedAt: datetime()
          })
          CREATE (${post})-[:HAS_TRANSLATION]->(translation)
        `,
        params: {
          id: params.id,
          translationId: params.translation.id,
          originalLanguage: params.originalLanguage,
          source: "original",
          aiStatus: AiStatus.Completed,
          title: params.translation.title,
          slug: params.translation.slug,
          summary: params.translation.summary ?? null,
          body: params.translation.body,
          bodyText: params.translation.bodyText,
          coverImageAlt: params.translation.coverImageAlt ?? null,
          readingMinutes: params.translation.readingMinutes,
        },
      },
      {
        query: `
          MATCH (${post}:${postLabel} {id: $id})
          MATCH (category:${categoryLabel})
          WHERE category.id IN $categoryIds
          MERGE (${post})-[:IN_BLOG_CATEGORY]->(category)
        `,
        params: { id: params.id, categoryIds: params.categoryIds },
      },
    ]);
  }

  /**
   * Full update of the language-independent fields: a missing coverImage clears it, and the
   * category edges become exactly `categoryIds`.
   */
  async updateShared(params: { id: string; coverImage?: string; categoryIds: string[] }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (${post}:${postLabel} {id: $id})
          SET ${post}.coverImage = $coverImage, ${post}.updatedAt = datetime()
        `,
        params: { id: params.id, coverImage: params.coverImage ?? null },
      },
      {
        query: `
          MATCH (${post}:${postLabel} {id: $id})-[edge:IN_BLOG_CATEGORY]->(category:${categoryLabel})
          WHERE NOT category.id IN $categoryIds
          DELETE edge
        `,
        params: { id: params.id, categoryIds: params.categoryIds },
      },
      {
        query: `
          MATCH (${post}:${postLabel} {id: $id})
          MATCH (category:${categoryLabel})
          WHERE category.id IN $categoryIds
          MERGE (${post})-[:IN_BLOG_CATEGORY]->(category)
        `,
        params: { id: params.id, categoryIds: params.categoryIds },
      },
    ]);
  }

  /**
   * Sets the status. Publishing stamps publishedAt only the first time, so unpublish and
   * republish keep the original date.
   */
  async setStatus(params: { id: string; status: BlogPostStatus }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (${post}:${postLabel} {id: $id})
          SET ${post}.status = $status, ${post}.updatedAt = datetime()
          ${params.status === "published" ? `SET ${post}.publishedAt = coalesce(${post}.publishedAt, datetime())` : ""}
        `,
        params: { id: params.id, status: params.status },
      },
    ]);
  }

  async deleteWithTranslations(params: { id: string }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (${post}:${postLabel} {id: $id})
          OPTIONAL MATCH (${post})-[:HAS_TRANSLATION]->(translation:${translationLabel})
          WITH ${post}, collect(translation) AS translations
          FOREACH (item IN translations | DETACH DELETE item)
          DETACH DELETE ${post}
        `,
        params: { id: params.id },
      },
    ]);
  }

  /**
   * Published posts in the visitor's language (original as fallback), newest first, optionally
   * filtered by a category slug in any language and searched through the translation full-text
   * index (only the resolved translation of each post can match).
   */
  async findPublished(params: {
    language: string;
    categorySlug?: string;
    term?: string;
    cursor: JsonApiCursorInterface;
  }): Promise<BlogPost[]> {
    const query = this.neo4j.initQuery({ serialiser: BlogPostDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      language: params.language,
      completedStatus: AiStatus.Completed,
      ...(params.categorySlug ? { categorySlug: params.categorySlug } : {}),
      ...(params.term ? { term: buildFulltextTerm(params.term) } : {}),
    };

    const categoryFilter = params.categorySlug
      ? `AND EXISTS {
          MATCH (${post})-[:IN_BLOG_CATEGORY]->(:${categoryLabel})-[:HAS_TRANSLATION]->(:${categoryTranslationLabel} {slug: $categorySlug})
        }`
      : "";

    if (params.term) {
      query.query += `
        CALL db.index.fulltext.queryNodes("${BlogPostTranslationDescriptor.fulltextIndexName}", $term)
        YIELD node, score
        MATCH (${post}:${postLabel})-[:HAS_TRANSLATION]->(node)
        WITH ${post}, node, score
        CALL {
          WITH ${post}
          ${this.buildDefaultMatch()}
          RETURN true AS ${post}_fulltextAccess
          LIMIT 1
        }
        WITH ${post}, node, score
        WHERE ${post}.status = "published"
        ${categoryFilter}
        ${this.buildResolvedTranslation(["node", "score"])}
        WITH ${post}, node, score, t
        WHERE node = t
        WITH ${post}, t, score
        ORDER BY score DESC
      `;
    } else {
      query.query += `
        ${this.buildDefaultMatch()}
        WHERE ${post}.status = "published"
        ${categoryFilter}
        ${this.buildResolvedTranslation()}
        WITH ${post}, t
        ORDER BY ${post}.publishedAt DESC
      `;
    }

    query.query += `
      {CURSOR}
      ${this.buildPublicReturn({ includeBody: false })}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * One published post by a slug of ANY of its languages, with the text resolved in $language.
   * When two posts share the slug in different languages, the one owning it in $language wins.
   */
  async findPublishedBySlug(params: { slug: string; language: string }): Promise<BlogPost | null> {
    const query = this.neo4j.initQuery({ serialiser: BlogPostDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      slug: params.slug,
      language: params.language,
      completedStatus: AiStatus.Completed,
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${post}.status = "published"
      AND EXISTS {
        MATCH (${post})-[:HAS_TRANSLATION]->(:${translationLabel} {slug: $slug})
      }
      WITH ${post},
        CASE WHEN EXISTS {
          MATCH (${post})-[:HAS_TRANSLATION]->(:${translationLabel} {slug: $slug, language: $language})
        } THEN 0 ELSE 1 END AS slugRank
      ORDER BY slugRank ASC
      LIMIT 1
      ${this.buildResolvedTranslation()}
      ${this.buildPublicReturn({ includeBody: true })}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Up to `limit` other published posts sharing a category with the given post, newest first.
   */
  async findPublishedRelated(params: { postId: string; language: string; limit: number }): Promise<BlogPost[]> {
    const query = this.neo4j.initQuery({ serialiser: BlogPostDescriptor.model, cursor: { take: params.limit } });

    query.queryParams = {
      ...query.queryParams,
      postId: params.postId,
      language: params.language,
      completedStatus: AiStatus.Completed,
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${post}.status = "published"
      AND ${post}.id <> $postId
      AND EXISTS {
        MATCH (${post})-[:IN_BLOG_CATEGORY]->(:${categoryLabel})<-[:IN_BLOG_CATEGORY]-(:${postLabel} {id: $postId})
      }
      ${this.buildResolvedTranslation()}
      WITH ${post}, t
      ORDER BY ${post}.publishedAt DESC
      {CURSOR}
      ${this.buildPublicReturn({ includeBody: false })}
    `;

    return this.neo4j.readManyWithoutCount(query);
  }
}
