import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { BlogCategoryTranslationPutDTO } from "../dtos/blog-category-translation.put.dto";
import { BlogCategoryTranslation, BlogCategoryTranslationDescriptor } from "../entities/blog-category-translation";
import { BlogCategoryTranslationRepository } from "../repositories/blog-category-translation.repository";
import { slugify, uniqueSlug } from "../utils/slug";
import { BlogQueueService } from "./blog-queue.service";

/**
 * Hand edits to a non-original category translation, and "Translate again"
 * for one language. The original is edited through BlogCategoryService only.
 */
@Injectable()
export class BlogCategoryTranslationService extends AbstractService<
  BlogCategoryTranslation,
  typeof BlogCategoryTranslationDescriptor.relationships
> {
  protected readonly descriptor = BlogCategoryTranslationDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly blogCategoryTranslationRepository: BlogCategoryTranslationRepository,
    clsService: ClsService,
    private readonly blogQueueService: BlogQueueService,
  ) {
    super(jsonApiService, blogCategoryTranslationRepository, clsService, BlogCategoryTranslationDescriptor.model);
  }

  /** Saves this one translation and marks it `manual`. Nothing is re-run. */
  async updateTranslation(params: { data: BlogCategoryTranslationPutDTO["data"] }): Promise<JsonApiSingleDocument> {
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
    } else if (!slug || attributes.name !== translation.name) {
      slug = await this._uniqueSlug({
        language: translation.language,
        text: attributes.name,
        excludeTranslationId: id,
      });
    }

    await this.blogCategoryTranslationRepository.updateText({
      id,
      name: attributes.name,
      slug,
      description: attributes.description,
      source: "manual",
    });

    return this.findById({ id });
  }

  /** Re-queues translation of this one language from the current original. */
  async retranslate(params: { id: string }): Promise<void> {
    const translation = await this._findEditable({ id: params.id });
    if (!translation.category?.id)
      throw new NotFoundException(`Blog category translation ${params.id} has no category`);
    await this.blogQueueService.enqueueCategoryLanguage({
      categoryId: translation.category.id,
      language: translation.language,
    });
  }

  private async _findEditable(params: { id: string }): Promise<BlogCategoryTranslation> {
    const translation = await this.blogCategoryTranslationRepository.findById({ id: params.id });
    if (!translation) throw new NotFoundException(`Blog category translation ${params.id} not found`);
    if (translation.isOriginal)
      throw new BadRequestException("The original is edited from the category, not as a translation");
    return translation;
  }

  private async _uniqueSlug(params: {
    language: string;
    text: string;
    excludeTranslationId?: string;
  }): Promise<string> {
    const base = slugify(params.text);
    const taken = await this.blogCategoryTranslationRepository.findSlugsWithPrefix({
      language: params.language,
      prefix: base,
      excludeTranslationId: params.excludeTranslationId,
    });
    return uniqueSlug(base, taken);
  }
}
