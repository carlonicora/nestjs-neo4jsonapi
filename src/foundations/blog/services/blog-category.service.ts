import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { ConfigI18nInterface } from "../../../config/interfaces/config.i18n.interface";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService, JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { BlogCategoryPostDTO } from "../dtos/blog-category.post.dto";
import { BlogCategoryPutDTO } from "../dtos/blog-category.put.dto";
import { BlogCategory, BlogCategoryDescriptor } from "../entities/blog-category";
import { BlogCategoryTranslationRepository } from "../repositories/blog-category-translation.repository";
import { BlogCategoryRepository } from "../repositories/blog-category.repository";
import { slugify, uniqueSlug } from "../utils/slug";
import { BlogQueueService } from "./blog-queue.service";
import { S3ClientKeyService } from "../../s3/services/s3-client-key.service";

/**
 * Blog categories: admin writes in the original language, translation through
 * the blog queue, and the public list resolved to one language.
 */
@Injectable()
export class BlogCategoryService extends AbstractService<BlogCategory, typeof BlogCategoryDescriptor.relationships> {
  protected readonly descriptor = BlogCategoryDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly blogCategoryRepository: BlogCategoryRepository,
    clsService: ClsService,
    private readonly blogCategoryTranslationRepository: BlogCategoryTranslationRepository,
    private readonly blogQueueService: BlogQueueService,
    private readonly configService: ConfigService,
    @Optional() private readonly s3ClientKeys?: S3ClientKeyService,
  ) {
    super(jsonApiService, blogCategoryRepository, clsService, BlogCategoryDescriptor.model);
  }

  async createFromDTO(params: { data: JsonApiDTOData; included?: unknown[] }): Promise<JsonApiSingleDocument> {
    // The controller validated the body against BlogCategoryPostDTO; the crud handler widens it to JsonApiDTOData.
    const data = params.data as unknown as BlogCategoryPostDTO["data"];
    const attributes = data.attributes;
    // A client-sent image key is checked against the app's S3 key policy before it is stored and signed.
    await this.s3ClientKeys?.assertClientKey({ key: attributes.image });
    const originalLanguage = attributes.originalLanguage;
    const supportedLanguages = this._supportedLanguages();

    if (!supportedLanguages.includes(originalLanguage))
      throw new BadRequestException(`Unsupported language: ${originalLanguage}`);

    const slug = await this._uniqueSlug({ language: originalLanguage, text: attributes.name });

    await this.blogCategoryRepository.createWithOriginal({
      id: data.id,
      originalLanguage,
      image: attributes.image,
      translation: {
        id: randomUUID(),
        name: attributes.name,
        slug,
        description: attributes.description,
      },
    });

    await this._queue({
      categoryId: data.id,
      languages: supportedLanguages.filter((language) => language !== originalLanguage),
    });

    return this.findById({ id: data.id });
  }

  /**
   * Updates the image and the original-language text. Translation re-runs only
   * when the original's text changed. The slug follows the name unless the
   * admin sets one explicitly.
   */
  async putFromDTO(params: { data: JsonApiDTOData; included?: unknown[] }): Promise<JsonApiSingleDocument> {
    // The controller validated the body against BlogCategoryPutDTO; the crud handler widens it to JsonApiDTOData.
    const data = params.data as unknown as BlogCategoryPutDTO["data"];
    const id = data.id;
    const attributes = data.attributes;
    // A client-sent image key is checked against the app's S3 key policy before it is stored and signed.
    await this.s3ClientKeys?.assertClientKey({ key: attributes.image });

    const category = await this.blogCategoryRepository.findById({ id });
    if (!category) throw new NotFoundException(`Blog category ${id} not found`);

    const original = await this.blogCategoryTranslationRepository.findOriginal({ categoryId: id });
    if (!original) throw new NotFoundException(`Blog category ${id} has no original text`);

    const textChanged =
      attributes.name !== original.name || (attributes.description ?? "") !== (original.description ?? "");

    let slug = original.slug;
    if (attributes.slug?.trim()) {
      slug = await this._uniqueSlug({
        language: category.originalLanguage,
        text: attributes.slug,
        excludeTranslationId: original.id,
      });
    } else if (!slug || attributes.name !== original.name) {
      slug = await this._uniqueSlug({
        language: category.originalLanguage,
        text: attributes.name,
        excludeTranslationId: original.id,
      });
    }

    // Omitted image = unchanged: the client only sends a key after a new upload.
    await this.blogCategoryRepository.updateShared({ id, image: attributes.image ?? category.image });

    await this.blogCategoryTranslationRepository.updateText({
      id: original.id,
      name: attributes.name,
      slug,
      description: attributes.description,
    });

    if (textChanged) {
      await this._queue({
        categoryId: id,
        languages: this._supportedLanguages().filter((language) => language !== category.originalLanguage),
      });
    }

    return this.findById({ id });
  }

  /** Deletes the category with every translation. */
  async delete(params: { id: string }): Promise<void> {
    const category = await this.blogCategoryRepository.findById({ id: params.id });
    if (!category) throw new NotFoundException(`Blog category ${params.id} not found`);
    await this.blogCategoryRepository.deleteWithTranslations({ id: params.id });
  }

  async findPublicList(params: { language: string }): Promise<JsonApiListDocument> {
    const data = await this.blogCategoryRepository.findPublicList({ language: params.language });
    // The public list is every category, never a page: fetchAll keeps a spurious "next" link out of it.
    const paginator = new JsonApiPaginator({ fetchAll: "true" });
    return this.jsonApiService.buildList(BlogCategoryDescriptor.model, data, paginator);
  }

  private async _queue(params: { categoryId: string; languages: string[] }): Promise<void> {
    if (params.languages.length === 0) return;
    await this.blogQueueService.enqueueCategory(params);
  }

  private _supportedLanguages(): string[] {
    return this.configService.get<ConfigI18nInterface>("i18n")?.supportedLanguages ?? ["en"];
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
