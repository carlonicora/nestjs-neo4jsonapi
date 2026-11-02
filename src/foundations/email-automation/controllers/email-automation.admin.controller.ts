import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { SystemRoles } from "../../../common/constants/system.roles";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import type { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { EmailAutomationEnrollmentPostDTO } from "../dtos/email-automation-enrollment.post.dto";
import { emailAutomationCandidateMeta } from "../entities/email-automation-candidate.meta";
import { emailAutomationEnrollmentMeta } from "../entities/email-automation-enrollment.meta";
import { emailAutomationMeta } from "../entities/email-automation.meta";
import { EmailAutomationService } from "../services/email-automation.service";

/**
 * Manual add of a person to an automation. Every route is administrator-only: the candidates
 * search reads across every company (EmailAutomationCandidateRepository), so each route carries
 * Roles(SystemRoles.Administrator) under the class-level JwtAuthGuard.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.EmailAutomation })
@Controller()
export class EmailAutomationAdminController {
  constructor(
    private readonly emailAutomationService: EmailAutomationService,
    private readonly cacheService: CacheService,
  ) {}

  @Get(`${emailAutomationMeta.endpoint}/:emailAutomationId/${emailAutomationCandidateMeta.endpoint}`)
  @Roles(SystemRoles.Administrator)
  async findCandidates(
    @Res() reply: FastifyReply,
    @Param("emailAutomationId") emailAutomationId: string,
    @Query() query: any,
    @Query("search") search?: string,
  ) {
    const response = await this.emailAutomationService.findCandidates({ id: emailAutomationId, search, query });
    reply.send(response);
  }

  @Post(`${emailAutomationMeta.endpoint}/:emailAutomationId/${emailAutomationEnrollmentMeta.endpoint}`)
  @Roles(SystemRoles.Administrator)
  @CacheInvalidate(emailAutomationMeta, "emailAutomationId")
  async addEnrollment(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("emailAutomationId") emailAutomationId: string,
    @Body() body: EmailAutomationEnrollmentPostDTO,
  ) {
    const response = await this.emailAutomationService.addEnrollment({
      id: emailAutomationId,
      data: body.data as unknown as JsonApiDTOData,
    });
    reply.send(response);
  }
}
