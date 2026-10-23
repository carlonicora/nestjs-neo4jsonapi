import { BadRequestException, Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { BLOG_SETTINGS_ID } from "../blog.constants";
import { BlogSettingsPutDTO } from "../dtos/blog-settings.put.dto";
import { BlogSettings, BlogSettingsDescriptor } from "../entities/blog-settings";
import { BlogSettingsRepository } from "../repositories/blog-settings.repository";

/**
 * The blog's singleton settings (the public list layout). Until an admin saves
 * them, reads return the default `featured` layout under BLOG_SETTINGS_ID.
 */
@Injectable()
export class BlogSettingsService extends AbstractService<BlogSettings, typeof BlogSettingsDescriptor.relationships> {
  protected readonly descriptor = BlogSettingsDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly blogSettingsRepository: BlogSettingsRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, blogSettingsRepository, clsService, BlogSettingsDescriptor.model);
  }

  async getSettings(): Promise<JsonApiSingleDocument> {
    const stored = await this.blogSettingsRepository.findSettings();
    const settings = stored ?? ({ id: BLOG_SETTINGS_ID, listLayout: "featured" } as BlogSettings);
    return this.jsonApiService.buildSingle(BlogSettingsDescriptor.model, settings);
  }

  async saveSettings(params: { data: BlogSettingsPutDTO["data"] }): Promise<JsonApiSingleDocument> {
    if (params.data.id !== BLOG_SETTINGS_ID) throw new BadRequestException("Unknown blog settings id");
    await this.blogSettingsRepository.upsert({ listLayout: params.data.attributes.listLayout });
    return this.getSettings();
  }
}
