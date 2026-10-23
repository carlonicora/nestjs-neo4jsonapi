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
import { BlogCategoryPostDTO } from "../dtos/blog-category.post.dto";
import { BlogCategoryPutDTO } from "../dtos/blog-category.put.dto";
import { blogCategoryMeta } from "../entities/blog-category.meta";
import { BlogCategoryService } from "../services/blog-category.service";

/**
 * Admin surface for blog categories. Every write is Administrator only, with
 * `@Roles` topmost (see BlogPostController).
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Blog })
@Controller()
export class BlogCategoryController {
  private readonly crud = createCrudHandlers(() => this.blogCategoryService);

  constructor(
    private readonly blogCategoryService: BlogCategoryService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Roles(RoleId.Administrator)
  @Get(blogCategoryMeta.endpoint)
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
  @Get(`${blogCategoryMeta.endpoint}/:blogCategoryId`)
  @Audit(blogCategoryMeta, "blogCategoryId")
  async findById(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("blogCategoryId") blogCategoryId: string,
  ) {
    return this.crud.findById(reply, blogCategoryId);
  }

  @Roles(RoleId.Administrator)
  @Post(blogCategoryMeta.endpoint)
  @CacheInvalidate(blogCategoryMeta)
  async create(@Res() reply: FastifyReply, @Body() body: BlogCategoryPostDTO) {
    return this.crud.create(reply, body);
  }

  @Roles(RoleId.Administrator)
  @Put(`${blogCategoryMeta.endpoint}/:blogCategoryId`)
  @ValidateId("blogCategoryId")
  @CacheInvalidate(blogCategoryMeta, "blogCategoryId")
  async update(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: BlogCategoryPutDTO) {
    return this.crud.update(reply, body);
  }

  @Roles(RoleId.Administrator)
  @Delete(`${blogCategoryMeta.endpoint}/:blogCategoryId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(blogCategoryMeta, "blogCategoryId")
  async delete(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("blogCategoryId") blogCategoryId: string,
  ) {
    return this.crud.delete(reply, blogCategoryId);
  }
}
