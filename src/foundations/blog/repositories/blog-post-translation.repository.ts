import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { BlogTranslationSource } from "../blog.constants";
import { blogPostMeta } from "../entities/blog-post.meta";
import { BlogPostTranslation, BlogPostTranslationDescriptor } from "../entities/blog-post-translation";
import { blogPostTranslationMeta } from "../entities/blog-post-translation.meta";

const translation = blogPostTranslationMeta.nodeName;
const translationLabel = blogPostTranslationMeta.labelName;
const postLabel = blogPostMeta.labelName;

@Injectable()
export class BlogPostTranslationRepository extends AbstractRepository<
  BlogPostTranslation,
  typeof BlogPostTranslationDescriptor.relationships
> {
  protected readonly descriptor = BlogPostTranslationDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * The original-language translation of a post.
   */
  async findOriginal(params: { postId: string }): Promise<BlogPostTranslation | null> {
    const query = this.neo4j.initQuery({ serialiser: BlogPostTranslationDescriptor.model });

    query.queryParams = { ...query.queryParams, postId: params.postId };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${translation}.isOriginal = true
      AND EXISTS {
        MATCH (${translation})<-[:HAS_TRANSLATION]-(:${postLabel} {id: $postId})
      }
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * The translation of a post in one language (original, AI, manual or placeholder).
   */
  async findByPostAndLanguage(params: { postId: string; language: string }): Promise<BlogPostTranslation | null> {
    const query = this.neo4j.initQuery({ serialiser: BlogPostTranslationDescriptor.model });

    query.queryParams = { ...query.queryParams, postId: params.postId, language: params.language };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${translation}.language = $language
      AND EXISTS {
        MATCH (${translation})<-[:HAS_TRANSLATION]-(:${postLabel} {id: $postId})
      }
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Every slug in one language (across all posts) starting with `prefix`, for the `-2`, `-3`
   * collision suffix. `excludeTranslationId` leaves out the record being re-slugged.
   */
  async findSlugsWithPrefix(params: {
    language: string;
    prefix: string;
    excludeTranslationId?: string;
  }): Promise<string[]> {
    const query = this.neo4j.initQuery({ serialiser: BlogPostTranslationDescriptor.model });

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

    const translations = await this.neo4j.readMany<BlogPostTranslation>(query);
    return translations.map((item) => item.slug).filter((slug): slug is string => !!slug);
  }

  /**
   * Creates (or keeps) one placeholder per non-original language and marks it pending, so the
   * admin sees "Translating..." at once. Existing records keep their text until the job writes.
   */
  async ensurePending(params: { postId: string; languages: string[] }): Promise<void> {
    if (params.languages.length === 0) return;

    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (post:${postLabel} {id: $postId})
          UNWIND $languages AS language
          WITH post, language
          WHERE language <> post.originalLanguage
          MERGE (post)-[:HAS_TRANSLATION]->(${translation}:${translationLabel} {language: language})
          ON CREATE SET
            ${translation}.id = randomUUID(),
            ${translation}.isOriginal = false,
            ${translation}.source = $source,
            ${translation}.createdAt = datetime()
          SET ${translation}.aiStatus = $aiStatus, ${translation}.updatedAt = datetime()
        `,
        params: {
          postId: params.postId,
          languages: params.languages,
          source: "ai",
          aiStatus: AiStatus.Pending,
        },
      },
    ]);
  }

  /**
   * Sets the AI status of the given non-original languages of a post.
   */
  async setAiStatus(params: { postId: string; languages: string[]; aiStatus: AiStatus }): Promise<void> {
    if (params.languages.length === 0) return;

    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (:${postLabel} {id: $postId})-[:HAS_TRANSLATION]->(${translation}:${translationLabel})
          WHERE ${translation}.language IN $languages
          AND ${translation}.isOriginal = false
          SET ${translation}.aiStatus = $aiStatus, ${translation}.updatedAt = datetime()
        `,
        params: { postId: params.postId, languages: params.languages, aiStatus: params.aiStatus },
      },
    ]);
  }

  /**
   * Rewrites the text of one translation and bumps the post's updatedAt. A `manual` source also
   * marks the record completed, so a hand-edited language is served even if its job had failed.
   */
  async updateText(params: {
    id: string;
    title: string;
    slug: string;
    summary?: string;
    body: string;
    bodyText: string;
    coverImageAlt?: string;
    readingMinutes: number;
    source?: BlogTranslationSource;
  }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (${translation}:${translationLabel} {id: $id})
          SET ${translation}.title = $title,
            ${translation}.slug = $slug,
            ${translation}.summary = $summary,
            ${translation}.body = $body,
            ${translation}.bodyText = $bodyText,
            ${translation}.coverImageAlt = $coverImageAlt,
            ${translation}.readingMinutes = $readingMinutes,
            ${translation}.updatedAt = datetime()
          ${params.source ? `SET ${translation}.source = $source` : ""}
          ${params.source === "manual" ? `SET ${translation}.aiStatus = $completedStatus` : ""}
          WITH ${translation}
          OPTIONAL MATCH (post:${postLabel})-[:HAS_TRANSLATION]->(${translation})
          FOREACH (item IN CASE WHEN post IS NULL THEN [] ELSE [post] END | SET item.updatedAt = datetime())
        `,
        params: {
          id: params.id,
          title: params.title,
          slug: params.slug,
          summary: params.summary ?? null,
          body: params.body,
          bodyText: params.bodyText,
          coverImageAlt: params.coverImageAlt ?? null,
          readingMinutes: params.readingMinutes,
          source: params.source ?? null,
          completedStatus: AiStatus.Completed,
        },
      },
    ]);
  }

  /**
   * Upserts the AI translation of a post in one non-original language: source "ai", status
   * completed, translatedAt now. Overwrites any manual edit, by design.
   */
  async writeAiTranslation(params: {
    postId: string;
    language: string;
    title: string;
    slug: string;
    summary?: string;
    body: string;
    bodyText: string;
    coverImageAlt?: string;
    readingMinutes: number;
  }): Promise<void> {
    await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (post:${postLabel} {id: $postId})
          WHERE post.originalLanguage <> $language
          MERGE (post)-[:HAS_TRANSLATION]->(${translation}:${translationLabel} {language: $language})
          ON CREATE SET
            ${translation}.id = randomUUID(),
            ${translation}.isOriginal = false,
            ${translation}.createdAt = datetime()
          SET ${translation}.source = $source,
            ${translation}.aiStatus = $aiStatus,
            ${translation}.title = $title,
            ${translation}.slug = $slug,
            ${translation}.summary = $summary,
            ${translation}.body = $body,
            ${translation}.bodyText = $bodyText,
            ${translation}.coverImageAlt = $coverImageAlt,
            ${translation}.readingMinutes = $readingMinutes,
            ${translation}.translatedAt = datetime(),
            ${translation}.updatedAt = datetime()
        `,
        params: {
          postId: params.postId,
          language: params.language,
          source: "ai",
          aiStatus: AiStatus.Completed,
          title: params.title,
          slug: params.slug,
          summary: params.summary ?? null,
          body: params.body,
          bodyText: params.bodyText,
          coverImageAlt: params.coverImageAlt ?? null,
          readingMinutes: params.readingMinutes,
        },
      },
    ]);
  }
}
