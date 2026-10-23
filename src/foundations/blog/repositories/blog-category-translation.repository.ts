import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { BlogTranslationSource } from "../blog.constants";
import { blogCategoryMeta } from "../entities/blog-category.meta";
import { BlogCategoryTranslation, BlogCategoryTranslationDescriptor } from "../entities/blog-category-translation";
import { blogCategoryTranslationMeta } from "../entities/blog-category-translation.meta";

const translation = blogCategoryTranslationMeta.nodeName;
const translationLabel = blogCategoryTranslationMeta.labelName;
const categoryLabel = blogCategoryMeta.labelName;

@Injectable()
export class BlogCategoryTranslationRepository extends AbstractRepository<
  BlogCategoryTranslation,
  typeof BlogCategoryTranslationDescriptor.relationships
> {
  protected readonly descriptor = BlogCategoryTranslationDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * The original-language translation of a category.
   */
  async findOriginal(params: { categoryId: string }): Promise<BlogCategoryTranslation | null> {
    const query = this.neo4j.initQuery({ serialiser: BlogCategoryTranslationDescriptor.model });

    query.queryParams = { ...query.queryParams, categoryId: params.categoryId };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${translation}.isOriginal = true
      AND EXISTS {
        MATCH (${translation})<-[:HAS_TRANSLATION]-(:${categoryLabel} {id: $categoryId})
      }
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * The translation of a category in one language (original, AI, manual or placeholder).
   */
  async findByCategoryAndLanguage(params: {
    categoryId: string;
    language: string;
  }): Promise<BlogCategoryTranslation | null> {
    const query = this.neo4j.initQuery({ serialiser: BlogCategoryTranslationDescriptor.model });

    query.queryParams = { ...query.queryParams, categoryId: params.categoryId, language: params.language };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${translation}.language = $language
      AND EXISTS {
        MATCH (${translation})<-[:HAS_TRANSLATION]-(:${categoryLabel} {id: $categoryId})
      }
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Every category slug in one language starting with `prefix`, for the collision suffix.
   * `excludeTranslationId` leaves out the record being re-slugged.
   */
  async findSlugsWithPrefix(params: {
    language: string;
    prefix: string;
    excludeTranslationId?: string;
  }): Promise<string[]> {
    const query = this.neo4j.initQuery({ serialiser: BlogCategoryTranslationDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      language: params.language,
      prefix: params.prefix,
      excludeTranslationId: params.excludeTranslationId ?? null,
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${translation}.language = $language
      AND ${translation}.slug STARTS WITH $prefix
      AND ($excludeTranslationId IS NULL OR ${translation}.id <> $excludeTranslationId)
      RETURN ${translation}
    `;

    const translations = await this.neo4j.readMany<BlogCategoryTranslation>(query);
    return translations.map((item) => item.slug).filter((slug): slug is string => !!slug);
  }

  /**
   * Creates (or keeps) one placeholder per non-original language and marks it pending.
   */
  async ensurePending(params: { categoryId: string; languages: string[] }): Promise<void> {
    if (params.languages.length === 0) return;

    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (category:${categoryLabel} {id: $categoryId})
          UNWIND $languages AS language
          WITH category, language
          WHERE language <> category.originalLanguage
          MERGE (category)-[:HAS_TRANSLATION]->(${translation}:${translationLabel} {language: language})
          ON CREATE SET
            ${translation}.id = randomUUID(),
            ${translation}.isOriginal = false,
            ${translation}.source = $source,
            ${translation}.createdAt = datetime()
          SET ${translation}.aiStatus = $aiStatus, ${translation}.updatedAt = datetime()
        `,
        params: {
          categoryId: params.categoryId,
          languages: params.languages,
          source: "ai",
          aiStatus: AiStatus.Pending,
        },
      },
    ]);
  }

  /**
   * Sets the AI status of the given non-original languages of a category.
   */
  async setAiStatus(params: { categoryId: string; languages: string[]; aiStatus: AiStatus }): Promise<void> {
    if (params.languages.length === 0) return;

    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (:${categoryLabel} {id: $categoryId})-[:HAS_TRANSLATION]->(${translation}:${translationLabel})
          WHERE ${translation}.language IN $languages
          AND ${translation}.isOriginal = false
          SET ${translation}.aiStatus = $aiStatus, ${translation}.updatedAt = datetime()
        `,
        params: { categoryId: params.categoryId, languages: params.languages, aiStatus: params.aiStatus },
      },
    ]);
  }

  /**
   * Rewrites the text of one category translation. A `manual` source also marks the record
   * completed, so a hand-edited language is served even if its job had failed.
   */
  async updateText(params: {
    id: string;
    name: string;
    slug: string;
    description?: string;
    source?: BlogTranslationSource;
  }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (${translation}:${translationLabel} {id: $id})
          SET ${translation}.name = $name,
            ${translation}.slug = $slug,
            ${translation}.description = $description,
            ${translation}.updatedAt = datetime()
          ${params.source ? `SET ${translation}.source = $source` : ""}
          ${params.source === "manual" ? `SET ${translation}.aiStatus = $completedStatus` : ""}
        `,
        params: {
          id: params.id,
          name: params.name,
          slug: params.slug,
          description: params.description ?? null,
          source: params.source ?? null,
          completedStatus: AiStatus.Completed,
        },
      },
    ]);
  }

  /**
   * Upserts the AI translation of a category in one non-original language.
   */
  async writeAiTranslation(params: {
    categoryId: string;
    language: string;
    name: string;
    slug: string;
    description?: string;
  }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (category:${categoryLabel} {id: $categoryId})
          WHERE category.originalLanguage <> $language
          MERGE (category)-[:HAS_TRANSLATION]->(${translation}:${translationLabel} {language: $language})
          ON CREATE SET
            ${translation}.id = randomUUID(),
            ${translation}.isOriginal = false,
            ${translation}.createdAt = datetime()
          SET ${translation}.source = $source,
            ${translation}.aiStatus = $aiStatus,
            ${translation}.name = $name,
            ${translation}.slug = $slug,
            ${translation}.description = $description,
            ${translation}.translatedAt = datetime(),
            ${translation}.updatedAt = datetime()
        `,
        params: {
          categoryId: params.categoryId,
          language: params.language,
          source: "ai",
          aiStatus: AiStatus.Completed,
          name: params.name,
          slug: params.slug,
          description: params.description ?? null,
        },
      },
    ]);
  }
}
