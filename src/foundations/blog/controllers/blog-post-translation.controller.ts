import { Body, Controller, HttpCode, HttpStatus, Param, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { RoleId } from "../../../common/constants/system.roles";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { ValidateId } from "../../../common/decorators/validate-id.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import type { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { BlogPostTranslationPutDTO } from "../dtos/blog-post-translation.put.dto";
import { blogPostMeta } from "../entities/blog-post.meta";
import { blogPostTranslationMeta } from "../entities/blog-post-translation.meta";
import { BlogPostTranslationService } from "../services/blog-post-translation.service";

/**
 * Admin writes on one post translation. A post response includes its
 * translations, so every write also invalidates the blog-posts type.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Blog })
@Controller()
export class BlogPostTranslationController {
  constructor(
    private readonly blogPostTranslationService: BlogPostTranslationService,
    private readonly cacheService: CacheService,
  ) {}

  @Roles(RoleId.Administrator)
  @Put(`${blogPostTranslationMeta.endpoint}/:blogPostTranslationId`)
  @ValidateId("blogPostTranslationId")
  @CacheInvalidate(blogPostTranslationMeta, "blogPostTranslationId")
  @CacheInvalidate(blogPostMeta)
  async update(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: BlogPostTranslationPutDTO,
  ) {
    const response = await this.blogPostTranslationService.updateTranslation({ data: body.data });
    reply.send(response);
  }

  @Roles(RoleId.Administrator)
  @Post(`${blogPostTranslationMeta.endpoint}/:blogPostTranslationId/retranslate`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(blogPostTranslationMeta, "blogPostTranslationId")
  @CacheInvalidate(blogPostMeta)
  async retranslate(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("blogPostTranslationId") blogPostTranslationId: string,
  ) {
    await this.blogPostTranslationService.retranslate({ id: blogPostTranslationId });
    reply.send();
  }
}
