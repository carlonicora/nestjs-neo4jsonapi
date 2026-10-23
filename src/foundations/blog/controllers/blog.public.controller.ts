import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { BLOG_PUBLIC_PREFIX } from "../blog.constants";
import { blogCategoryMeta } from "../entities/blog-category.meta";
import { blogPostMeta } from "../entities/blog-post.meta";
import { blogSettingsMeta } from "../entities/blog-settings.meta";
import { BlogCategoryService } from "../services/blog-category.service";
import { BlogPostService } from "../services/blog-post.service";
import { BlogSettingsService } from "../services/blog-settings.service";

/**
 * Unauthenticated read surface for PUBLISHED blog posts, the categories and
 * the list layout. Auth in this package is per-controller; omitting
 * JwtAuthGuard makes these routes public.
 *
 * OPT-IN ONLY: registered exclusively by `BlogModule.forRoot({ publicRoutes: true })`.
 * Drafts and unpublished posts are never served (the repository filters on
 * `status = "published"`), and responses never contain the author's User node:
 * the author shows only as the computed `authorName`.
 */
@Controller()
export class BlogPublicController {
  constructor(
    private readonly blogPostService: BlogPostService,
    private readonly blogCategoryService: BlogCategoryService,
    private readonly blogSettingsService: BlogSettingsService,
  ) {}

  @Get(`${BLOG_PUBLIC_PREFIX}/${blogPostMeta.endpoint}`)
  async findPublished(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("language") language = "en",
    @Query("category") category?: string,
    @Query("search") search?: string,
  ) {
    const response = await this.blogPostService.findPublishedList({
      query,
      language,
      categorySlug: category,
      search,
    });
    reply.send(response);
  }

  @Get(`${BLOG_PUBLIC_PREFIX}/${blogPostMeta.endpoint}/:slug`)
  async findBySlug(@Res() reply: FastifyReply, @Param("slug") slug: string, @Query("language") language = "en") {
    const response = await this.blogPostService.findPublishedBySlug({ slug, language });
    reply.send(response);
  }

  @Get(`${BLOG_PUBLIC_PREFIX}/${blogPostMeta.endpoint}/:slug/related`)
  async findRelated(@Res() reply: FastifyReply, @Param("slug") slug: string, @Query("language") language = "en") {
    const response = await this.blogPostService.findPublishedRelated({ slug, language });
    reply.send(response);
  }

  @Get(`${BLOG_PUBLIC_PREFIX}/${blogCategoryMeta.endpoint}`)
  async findCategories(@Res() reply: FastifyReply, @Query("language") language = "en") {
    const response = await this.blogCategoryService.findPublicList({ language });
    reply.send(response);
  }

  @Get(`${BLOG_PUBLIC_PREFIX}/${blogSettingsMeta.endpoint}`)
  async findSettings(@Res() reply: FastifyReply) {
    const response = await this.blogSettingsService.getSettings();
    reply.send(response);
  }
}
