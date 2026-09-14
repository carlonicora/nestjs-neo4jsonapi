import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { Audit } from "../../../common/decorators/audit.decorator";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { handbookPageMeta } from "../entities/handbook-page.meta";
import { handbookSectionMeta } from "../entities/handbook-section.meta";
import { HandbookIngestService } from "../services/handbook-ingest.service";
import { HandbookPageService } from "../services/handbook-page.service";
import { HandbookSectionService } from "../services/handbook-section.service";

/**
 * Developer documentation is administrator-only, enforced HERE and not merely by
 * whatever admin layout a consumer's frontend happens to have. AdminJwtAuthGuard
 * pushes the Administrator role into the required-roles set for every handler
 * (common/guards/jwt.auth.admin.guard.ts — `_validateRoles`), so read routes are
 * gated too.
 */
@UseGuards(AdminJwtAuthGuard)
@Controller()
export class HandbookController {
  private readonly crud = createCrudHandlers(() => this.handbookPageService);
  private readonly sections = createCrudHandlers(() => this.handbookSectionService);

  constructor(
    private readonly handbookPageService: HandbookPageService,
    private readonly handbookSectionService: HandbookSectionService,
    private readonly handbookIngestService: HandbookIngestService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(handbookPageMeta.endpoint)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
  }

  @Get(handbookSectionMeta.endpoint)
  async findAllSections(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.sections.findAll(reply, { query, search, fetchAll, orderBy });
  }

  // Declared BEFORE the :handbookPageId route so "sync" is never read as an id.
  @Post(`${handbookPageMeta.endpoint}/sync`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(handbookPageMeta)
  async sync(@Res() reply: FastifyReply) {
    await this.handbookIngestService.sync();
    reply.send();
  }

  @Get(`${handbookPageMeta.endpoint}/:handbookPageId`)
  @Audit(handbookPageMeta, "handbookPageId")
  async findById(@Res() reply: FastifyReply, @Param("handbookPageId") handbookPageId: string) {
    return this.crud.findById(reply, handbookPageId);
  }

  @Delete(`${handbookPageMeta.endpoint}/:handbookPageId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(handbookPageMeta, "handbookPageId")
  async delete(@Res() reply: FastifyReply, @Param("handbookPageId") handbookPageId: string) {
    return this.crud.delete(reply, handbookPageId);
  }
}
