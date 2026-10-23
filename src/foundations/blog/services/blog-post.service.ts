import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { ConfigI18nInterface } from "../../../config/interfaces/config.i18n.interface";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService, JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { BlogPostPostDTO } from "../dtos/blog-post.post.dto";
import { BlogPostPutDTO } from "../dtos/blog-post.put.dto";
import { BlogPost, BlogPostDescriptor } from "../entities/blog-post";
import { BlogPostTranslationRepository } from "../repositories/blog-post-translation.repository";
import { BlogPostRepository } from "../repositories/blog-post.repository";
import { readingMinutes } from "../utils/reading-time";
import { slugify, uniqueSlug } from "../utils/slug";
import { BlogQueueService } from "./blog-queue.service";
import { S3ClientKeyService } from "../../s3/services/s3-client-key.service";

/** Largest page the public list serves (the web asks for 12 per "Load more" step). */
const PUBLIC_MAX_PAGE_SIZE = 120;

const RELATED_LIMIT = 3;

/**
 * Blog posts: admin writes (original language only), publishing, and the
 * public reads that resolve one language per post.
 */
@Injectable()
export class BlogPostService extends AbstractService<BlogPost, typeof BlogPostDescriptor.relationships> {
  protected readonly descriptor = BlogPostDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly blogPostRepository: BlogPostRepository,
    clsService: ClsService,
    private readonly blogPostTranslationRepository: BlogPostTranslationRepository,
    private readonly blogQueueService: BlogQueueService,
    private readonly blockNoteService: BlockNoteService,
    private readonly configService: ConfigService,
    @Optional() private readonly s3ClientKeys?: S3ClientKeyService,
  ) {
    super(jsonApiService, blogPostRepository, clsService, BlogPostDescriptor.model);
  }

  /**
   * Creates a draft with its original-language text, then queues the summary
   * (unless the admin wrote one) and the translation into every other language.
   */
  async createFromDTO(params: { data: JsonApiDTOData; included?: unknown[] }): Promise<JsonApiSingleDocument> {
    // The controller validated the body against BlogPostPostDTO; the crud handler widens it to JsonApiDTOData.
    const data = params.data as unknown as BlogPostPostDTO["data"];
    const attributes = data.attributes;
    // A client-sent image key is checked against the app's S3 key policy before it is stored and signed.
    await this.s3ClientKeys?.assertClientKey({ key: attributes.coverImage });
    const originalLanguage = attributes.originalLanguage;
    const supportedLanguages = this._supportedLanguages();

    if (!supportedLanguages.includes(originalLanguage))
      throw new BadRequestException(`Unsupported language: ${originalLanguage}`);

    const bodyText = this._plainText(attributes.body);
    const slug = await this._uniqueSlug({ language: originalLanguage, text: attributes.title });
    const summary = attributes.summary?.trim() ? attributes.summary : undefined;

    await this.blogPostRepository.createWithOriginal({
      id: data.id,
      authorId: this.clsService.get("userId"),
      originalLanguage,
      coverImage: attributes.coverImage,
      categoryIds: this._categoryIds(data),
      translation: {
        id: randomUUID(),
        title: attributes.title,
        slug,
        summary,
        body: attributes.body,
        bodyText,
        coverImageAlt: attributes.coverImageAlt,
        readingMinutes: readingMinutes(bodyText),
      },
    });

    await this._queue({
      postId: data.id,
      generateSummary: !summary,
      languages: supportedLanguages.filter((language) => language !== originalLanguage),
    });

    return this.findById({ id: data.id });
  }

  /**
   * Updates the shared fields and the original-language text.
   *
   * - A published post keeps its slugs when the title changes (old links keep
   *   working); an explicit `slug` is always applied.
   * - Translation re-runs only when the original's text changed, and it
   *   overwrites hand-edited translations.
   * - The summary is regenerated when the body changed and the admin did not
   *   edit the summary on this save, or when it was cleared.
   */
  async putFromDTO(params: { data: JsonApiDTOData; included?: unknown[] }): Promise<JsonApiSingleDocument> {
    // The controller validated the body against BlogPostPutDTO; the crud handler widens it to JsonApiDTOData.
    const data = params.data as unknown as BlogPostPutDTO["data"];
    const id = data.id;
    const attributes = data.attributes;
    // A client-sent image key is checked against the app's S3 key policy before it is stored and signed.
    await this.s3ClientKeys?.assertClientKey({ key: attributes.coverImage });

    const post = await this.blogPostRepository.findById({ id });
    if (!post) throw new NotFoundException(`Blog post ${id} not found`);

    const original = await this.blogPostTranslationRepository.findOriginal({ postId: id });
    if (!original) throw new NotFoundException(`Blog post ${id} has no original text`);

    const title = attributes.title;
    const body = attributes.body;
    // Omitted summary = untouched (keep the stored one); an empty string = cleared (regenerate).
    const summary =
      attributes.summary === undefined ? original.summary : attributes.summary.trim() ? attributes.summary : undefined;
    const coverImageAlt = attributes.coverImageAlt;

    const bodyChanged = body !== original.body;
    const summaryChanged = (summary ?? "") !== (original.summary ?? "");
    const textChanged =
      bodyChanged ||
      summaryChanged ||
      title !== original.title ||
      (coverImageAlt ?? "") !== (original.coverImageAlt ?? "");

    let slug = original.slug;
    if (attributes.slug?.trim()) {
      slug = await this._uniqueSlug({
        language: post.originalLanguage,
        text: attributes.slug,
        excludeTranslationId: original.id,
      });
    } else if (!slug || (post.status !== "published" && title !== original.title)) {
      slug = await this._uniqueSlug({
        language: post.originalLanguage,
        text: title,
        excludeTranslationId: original.id,
      });
    }

    const bodyText = this._plainText(body);

    await this.blogPostRepository.updateShared({
      id,
      // Omitted cover = unchanged: the client only sends a key after a new upload.
      coverImage: attributes.coverImage ?? post.coverImage,
      categoryIds: this._categoryIds(data),
    });

    await this.blogPostTranslationRepository.updateText({
      id: original.id,
      title,
      slug,
      summary,
      body,
      bodyText,
      coverImageAlt,
      readingMinutes: readingMinutes(bodyText),
    });

    if (textChanged) {
      await this._queue({
        postId: id,
        generateSummary: !summary || (bodyChanged && !summaryChanged),
        languages: this._supportedLanguages().filter((language) => language !== post.originalLanguage),
      });
    }

    return this.findById({ id });
  }

  /** Deletes the post with every translation. */
  async delete(params: { id: string }): Promise<void> {
    const post = await this.blogPostRepository.findById({ id: params.id });
    if (!post) throw new NotFoundException(`Blog post ${params.id} not found`);
    await this.blogPostRepository.deleteWithTranslations({ id: params.id });
  }

  /** Publishes (or republishes) a post. The first publish date is kept. */
  async publish(params: { id: string }): Promise<JsonApiSingleDocument> {
    const post = await this.blogPostRepository.findById({ id: params.id });
    if (!post) throw new NotFoundException(`Blog post ${params.id} not found`);
    await this.blogPostRepository.setStatus({ id: params.id, status: "published" });
    return this.findById({ id: params.id });
  }

  async unpublish(params: { id: string }): Promise<JsonApiSingleDocument> {
    const post = await this.blogPostRepository.findById({ id: params.id });
    if (!post) throw new NotFoundException(`Blog post ${params.id} not found`);
    if (post.status !== "published") throw new BadRequestException(`Blog post ${params.id} is not published`);
    await this.blogPostRepository.setStatus({ id: params.id, status: "unpublished" });
    return this.findById({ id: params.id });
  }

  async findPublishedList(params: {
    query: any;
    language: string;
    categorySlug?: string;
    search?: string;
  }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(this._clampPublicPageSize(params.query));
    const data = await this.blogPostRepository.findPublished({
      language: params.language,
      categorySlug: params.categorySlug || undefined,
      term: params.search?.trim() || undefined,
      cursor: paginator.generateCursor(),
    });
    return this.jsonApiService.buildList(BlogPostDescriptor.model, data, paginator);
  }

  /** 404 for an unknown slug and for a draft or unpublished post. */
  async findPublishedBySlug(params: { slug: string; language: string }): Promise<JsonApiSingleDocument> {
    const post = await this.blogPostRepository.findPublishedBySlug(params);
    if (!post) throw new NotFoundException(`Blog post ${params.slug} not found`);
    return this.jsonApiService.buildSingle(BlogPostDescriptor.model, post);
  }

  async findPublishedRelated(params: { slug: string; language: string }): Promise<JsonApiListDocument> {
    const post = await this.blogPostRepository.findPublishedBySlug(params);
    if (!post) throw new NotFoundException(`Blog post ${params.slug} not found`);
    const data = await this.blogPostRepository.findPublishedRelated({
      postId: post.id,
      language: params.language,
      limit: RELATED_LIMIT,
    });
    const paginator = new JsonApiPaginator();
    return this.jsonApiService.buildList(BlogPostDescriptor.model, data, paginator);
  }

  private async _queue(params: { postId: string; generateSummary: boolean; languages: string[] }): Promise<void> {
    if (!params.generateSummary && params.languages.length === 0) return;
    await this.blogQueueService.enqueuePost(params);
  }

  private _supportedLanguages(): string[] {
    return this.configService.get<ConfigI18nInterface>("i18n")?.supportedLanguages ?? ["en"];
  }

  private _plainText(body: string): string {
    try {
      return this.blockNoteService.convertToPlainText({ nodes: JSON.parse(body) });
    } catch {
      throw new BadRequestException("The body is not valid BlockNote JSON");
    }
  }

  private _categoryIds(data: { relationships?: any }): string[] {
    const items = data.relationships?.categories?.data;
    return Array.isArray(items) ? items.map((item: { id: string }) => item.id) : [];
  }

  private async _uniqueSlug(params: {
    language: string;
    text: string;
    excludeTranslationId?: string;
  }): Promise<string> {
    const base = slugify(params.text);
    const taken = await this.blogPostTranslationRepository.findSlugsWithPrefix({
      language: params.language,
      prefix: base,
      excludeTranslationId: params.excludeTranslationId,
    });
    return uniqueSlug(base, taken);
  }

  /**
   * Anonymous visitors set page[size] through the URL ("Load more" grows it), so the
   * public list caps it: an unbounded size would let anyone force a full-table read.
   */
  private _clampPublicPageSize(query: any): any {
    if (!query) return query;
    const clamp = (value: unknown) => String(Math.min(Math.max(1, Number(value) || 1), PUBLIC_MAX_PAGE_SIZE));
    const clamped = { ...query };
    if (clamped["page[size]"] !== undefined) clamped["page[size]"] = clamp(clamped["page[size]"]);
    if (clamped.page?.size !== undefined) clamped.page = { ...clamped.page, size: clamp(clamped.page.size) };
    return clamped;
  }
}
