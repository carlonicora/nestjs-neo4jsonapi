import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { RoleId } from "../../../common/constants/system.roles";
import { Audit } from "../../../common/decorators/audit.decorator";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { ValidateId } from "../../../common/decorators/validate-id.decorator";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import type { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { EmailAutomationPatchDTO } from "../dtos/email-automation.patch.dto";
import { EmailAutomationPostDTO } from "../dtos/email-automation.post.dto";
import { emailAutomationEnrollmentMeta } from "../entities/email-automation-enrollment.meta";
import { emailAutomationStepMeta } from "../entities/email-automation-step.meta";
import { emailAutomationMeta } from "../entities/email-automation.meta";
import { EmailAutomationStepService } from "../services/email-automation-step.service";
import { EmailAutomationService } from "../services/email-automation.service";

@UseGuards(AdminJwtAuthGuard)
@Controller()
export class EmailAutomationController {
  private readonly crud = createCrudHandlers(() => this.emailAutomationService);

  constructor(
    private readonly emailAutomationService: EmailAutomationService,
    private readonly stepService: EmailAutomationStepService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Declared before the `:emailAutomationId` routes so "triggers" is never read as an id.
   */
  @Get(`${emailAutomationMeta.endpoint}/triggers`)
  @Roles(RoleId.Administrator)
  async findTriggers(@Res() reply: FastifyReply) {
    const response = await this.emailAutomationService.listTriggers();
    reply.send(response);
  }

  @Get(emailAutomationMeta.endpoint)
  @Roles(RoleId.Administrator)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
  }

  @Get(`${emailAutomationMeta.endpoint}/:emailAutomationId`)
  @Roles(RoleId.Administrator)
  @Audit(emailAutomationMeta, "emailAutomationId")
  async findById(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("emailAutomationId") emailAutomationId: string,
  ) {
    return this.crud.findById(reply, emailAutomationId);
  }

  @Post(emailAutomationMeta.endpoint)
  @Roles(RoleId.Administrator)
  @CacheInvalidate(emailAutomationMeta)
  async create(@Res() reply: FastifyReply, @Body() body: EmailAutomationPostDTO) {
    return this.crud.create(reply, body);
  }

  @Patch(`${emailAutomationMeta.endpoint}/:emailAutomationId`)
  @Roles(RoleId.Administrator)
  @ValidateId("emailAutomationId")
  @CacheInvalidate(emailAutomationMeta, "emailAutomationId")
  async patch(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: EmailAutomationPatchDTO) {
    return this.crud.patch(reply, body);
  }

  @Delete(`${emailAutomationMeta.endpoint}/:emailAutomationId`)
  @Roles(RoleId.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(emailAutomationMeta, "emailAutomationId")
  async delete(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("emailAutomationId") emailAutomationId: string,
  ) {
    return this.crud.delete(reply, emailAutomationId);
  }

  @Get(`${emailAutomationMeta.endpoint}/:emailAutomationId/${emailAutomationStepMeta.endpoint}`)
  @Roles(RoleId.Administrator)
  async findSteps(
    @Res() reply: FastifyReply,
    @Param("emailAutomationId") emailAutomationId: string,
    @Query() query: any,
  ) {
    const response = await this.stepService.findByAutomation({ automationId: emailAutomationId, query });
    reply.send(response);
  }

  @Get(`${emailAutomationMeta.endpoint}/:emailAutomationId/${emailAutomationEnrollmentMeta.endpoint}`)
  @Roles(RoleId.Administrator)
  async findEnrollments(
    @Res() reply: FastifyReply,
    @Param("emailAutomationId") emailAutomationId: string,
    @Query() query: any,
    @Query("status") status?: string,
  ) {
    const response = await this.emailAutomationService.findEnrollments({ id: emailAutomationId, status, query });
    reply.send(response);
  }

  @Post(`${emailAutomationMeta.endpoint}/:emailAutomationId/tidy`)
  @Roles(RoleId.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(emailAutomationMeta, "emailAutomationId")
  async tidy(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("emailAutomationId") emailAutomationId: string,
  ) {
    await this.emailAutomationService.tidy({ id: emailAutomationId });
    reply.send();
  }
}
