import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { RoleId } from "../../../common/constants/system.roles";
import { Audit } from "../../../common/decorators/audit.decorator";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { ValidateId } from "../../../common/decorators/validate-id.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import type { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { BlogPostPostDTO } from "../dtos/blog-post.post.dto";
import { BlogPostPutDTO } from "../dtos/blog-post.put.dto";
import { blogPostMeta } from "../entities/blog-post.meta";
import { BlogPostService } from "../services/blog-post.service";

/**
 * Admin surface for blog posts. The blog is global platform content, so every
 * write is Administrator only. `@Roles` sits above `@CacheInvalidate` /
 * `@ValidateId` on each write: both replace the method, and metadata set below
 * them would never be enforced.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Blog })
@Controller()
export class BlogPostController {
  private readonly crud = createCrudHandlers(() => this.blogPostService);

  constructor(
    private readonly blogPostService: BlogPostService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Roles(RoleId.Administrator)
  @Get(blogPostMeta.endpoint)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
  }

  @Roles(RoleId.Administrator)
  @Get(`${blogPostMeta.endpoint}/:blogPostId`)
  @Audit(blogPostMeta, "blogPostId")
  async findById(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("blogPostId") blogPostId: string,
  ) {
    return this.crud.findById(reply, blogPostId);
  }

  @Roles(RoleId.Administrator)
  @Post(blogPostMeta.endpoint)
  @CacheInvalidate(blogPostMeta)
  async create(@Res() reply: FastifyReply, @Body() body: BlogPostPostDTO) {
    return this.crud.create(reply, body);
  }

  @Roles(RoleId.Administrator)
  @Put(`${blogPostMeta.endpoint}/:blogPostId`)
  @ValidateId("blogPostId")
  @CacheInvalidate(blogPostMeta, "blogPostId")
  async update(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: BlogPostPutDTO) {
    return this.crud.update(reply, body);
  }

  @Roles(RoleId.Administrator)
  @Delete(`${blogPostMeta.endpoint}/:blogPostId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(blogPostMeta, "blogPostId")
  async delete(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("blogPostId") blogPostId: string,
  ) {
    return this.crud.delete(reply, blogPostId);
  }

  @Roles(RoleId.Administrator)
  @Post(`${blogPostMeta.endpoint}/:blogPostId/publish`)
  @CacheInvalidate(blogPostMeta, "blogPostId")
  async publish(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("blogPostId") blogPostId: string,
  ) {
    const response = await this.blogPostService.publish({ id: blogPostId });
    reply.send(response);
  }

  @Roles(RoleId.Administrator)
  @Post(`${blogPostMeta.endpoint}/:blogPostId/unpublish`)
  @CacheInvalidate(blogPostMeta, "blogPostId")
  async unpublish(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("blogPostId") blogPostId: string,
  ) {
    const response = await this.blogPostService.unpublish({ id: blogPostId });
    reply.send(response);
  }
}
