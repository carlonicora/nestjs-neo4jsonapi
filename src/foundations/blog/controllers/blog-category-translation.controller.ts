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
import { BlogCategoryTranslationPutDTO } from "../dtos/blog-category-translation.put.dto";
import { blogCategoryMeta } from "../entities/blog-category.meta";
import { blogCategoryTranslationMeta } from "../entities/blog-category-translation.meta";
import { BlogCategoryTranslationService } from "../services/blog-category-translation.service";

/**
 * Admin writes on one category translation. A category response includes its
 * translations, so every write also invalidates the blog-categories type.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Blog })
@Controller()
export class BlogCategoryTranslationController {
  constructor(
    private readonly blogCategoryTranslationService: BlogCategoryTranslationService,
    private readonly cacheService: CacheService,
  ) {}

  @Roles(RoleId.Administrator)
  @Put(`${blogCategoryTranslationMeta.endpoint}/:blogCategoryTranslationId`)
  @ValidateId("blogCategoryTranslationId")
  @CacheInvalidate(blogCategoryTranslationMeta, "blogCategoryTranslationId")
  @CacheInvalidate(blogCategoryMeta)
  async update(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: BlogCategoryTranslationPutDTO,
  ) {
    const response = await this.blogCategoryTranslationService.updateTranslation({ data: body.data });
    reply.send(response);
  }

  @Roles(RoleId.Administrator)
  @Post(`${blogCategoryTranslationMeta.endpoint}/:blogCategoryTranslationId/retranslate`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(blogCategoryTranslationMeta, "blogCategoryTranslationId")
  @CacheInvalidate(blogCategoryMeta)
  async retranslate(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("blogCategoryTranslationId") blogCategoryTranslationId: string,
  ) {
    await this.blogCategoryTranslationService.retranslate({ id: blogCategoryTranslationId });
    reply.send();
  }
}
