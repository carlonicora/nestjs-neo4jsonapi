import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { BlogPostTranslationPutDTO } from "../dtos/blog-post-translation.put.dto";
import { BlogPostTranslation, BlogPostTranslationDescriptor } from "../entities/blog-post-translation";
import { BlogPostTranslationRepository } from "../repositories/blog-post-translation.repository";
import { readingMinutes } from "../utils/reading-time";
import { slugify, uniqueSlug } from "../utils/slug";
import { BlogQueueService } from "./blog-queue.service";

/**
 * Hand edits to a non-original post translation, and "Translate again" for
 * one language. The original is edited through BlogPostService only.
 */
@Injectable()
export class BlogPostTranslationService extends AbstractService<
  BlogPostTranslation,
  typeof BlogPostTranslationDescriptor.relationships
> {
  protected readonly descriptor = BlogPostTranslationDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly blogPostTranslationRepository: BlogPostTranslationRepository,
    clsService: ClsService,
    private readonly blogQueueService: BlogQueueService,
    private readonly blockNoteService: BlockNoteService,
  ) {
    super(jsonApiService, blogPostTranslationRepository, clsService, BlogPostTranslationDescriptor.model);
  }

  /**
   * Saves this one translation and marks it `manual`. Nothing is re-run.
   * The slug follows the post rule: kept once the post is published, unless the
   * admin sets one explicitly.
   */
  async updateTranslation(params: { data: BlogPostTranslationPutDTO["data"] }): Promise<JsonApiSingleDocument> {
    const id = params.data.id;
    const attributes = params.data.attributes;

    const translation = await this._findEditable({ id });

    let slug = translation.slug;
    if (attributes.slug?.trim()) {
      slug = await this._uniqueSlug({
        language: translation.language,
        text: attributes.slug,
        excludeTranslationId: id,
      });
    } else if (!slug || (translation.post?.status !== "published" && attributes.title !== translation.title)) {
      slug = await this._uniqueSlug({
        language: translation.language,
        text: attributes.title,
        excludeTranslationId: id,
      });
    }

    const bodyText = this._plainText(attributes.body);

    await this.blogPostTranslationRepository.updateText({
      id,
      title: attributes.title,
      slug,
      summary: attributes.summary?.trim() ? attributes.summary : undefined,
      body: attributes.body,
      bodyText,
      coverImageAlt: attributes.coverImageAlt,
      readingMinutes: readingMinutes(bodyText),
      source: "manual",
    });

    return this.findById({ id });
  }

  /** Re-queues translation of this one language from the current original. */
  async retranslate(params: { id: string }): Promise<void> {
    const translation = await this._findEditable({ id: params.id });
    if (!translation.post?.id) throw new NotFoundException(`Blog post translation ${params.id} has no post`);
    await this.blogQueueService.enqueuePostLanguage({ postId: translation.post.id, language: translation.language });
  }

  private async _findEditable(params: { id: string }): Promise<BlogPostTranslation> {
    const translation = await this.blogPostTranslationRepository.findById({ id: params.id });
    if (!translation) throw new NotFoundException(`Blog post translation ${params.id} not found`);
    if (translation.isOriginal)
      throw new BadRequestException("The original is edited from the post, not as a translation");
    return translation;
  }

  private _plainText(body: string): string {
    try {
      return this.blockNoteService.convertToPlainText({ nodes: JSON.parse(body) });
    } catch {
      throw new BadRequestException("The body is not valid BlockNote JSON");
    }
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
}
