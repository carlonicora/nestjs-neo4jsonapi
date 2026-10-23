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
import { EmailAutomationStepDataDTO } from "../dtos/email-automation-step.dto";
import { EmailAutomationStepPatchDTO } from "../dtos/email-automation-step.patch.dto";
import { EmailAutomationStepPostDTO } from "../dtos/email-automation-step.post.dto";
import { emailAutomationStepMeta } from "../entities/email-automation-step.meta";
import { emailAutomationMeta } from "../entities/email-automation.meta";
import { EmailAutomationStepService } from "../services/email-automation-step.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

@UseGuards(AdminJwtAuthGuard)
@ModuleACL({ module: CoreModuleId.EmailAutomation })
@Controller()
export class EmailAutomationStepController {
  private readonly crud = createCrudHandlers(() => this.stepService);

  constructor(
    private readonly stepService: EmailAutomationStepService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Post(emailAutomationStepMeta.endpoint)
  @Roles(RoleId.Administrator)
  @CacheInvalidate(emailAutomationStepMeta)
  async create(@Res() reply: FastifyReply, @Body() body: EmailAutomationStepPostDTO) {
    const response = await this.crud.create(reply, body);

    // The parent automation's stepCount changed with the new step
    await this.cacheService.invalidateByElement(
      emailAutomationMeta.endpoint,
      body.data.relationships.automation.data.id,
    );

    return response;
  }

  @Get(`${emailAutomationStepMeta.endpoint}/:stepId`)
  @Roles(RoleId.Administrator)
  @Audit(emailAutomationStepMeta, "stepId")
  async findById(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("stepId") stepId: string) {
    return this.crud.findById(reply, stepId);
  }

  @Patch(`${emailAutomationStepMeta.endpoint}/:stepId`)
  @Roles(RoleId.Administrator)
  @ValidateId("stepId")
  @CacheInvalidate(emailAutomationStepMeta, "stepId")
  async patch(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: EmailAutomationStepPatchDTO,
  ) {
    return this.crud.patch(reply, body);
  }

  @Delete(`${emailAutomationStepMeta.endpoint}/:stepId`)
  @Roles(RoleId.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(emailAutomationStepMeta, "stepId")
  async delete(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("stepId") stepId: string) {
    const automationId = await this.stepService.deleteStep({ id: stepId });

    // The parent automation's stepCount changed with the removed step
    if (automationId) await this.cacheService.invalidateByElement(emailAutomationMeta.endpoint, automationId);

    reply.send();
  }

  @Post(`${emailAutomationStepMeta.endpoint}/:stepId/next`)
  @Roles(RoleId.Administrator)
  @CacheInvalidate(emailAutomationStepMeta, "stepId")
  async setNext(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("stepId") stepId: string,
    @Body() body: EmailAutomationStepDataDTO,
  ) {
    const response = await this.stepService.setNext({ stepId, nextStepId: body.data.id });

    // The parent automation's step chain changed with the new link
    const automationId = await this.stepService.findAutomationId({ stepId });
    if (automationId) await this.cacheService.invalidateByElement(emailAutomationMeta.endpoint, automationId);

    reply.send(response);
  }

  @Delete(`${emailAutomationStepMeta.endpoint}/:stepId/next`)
  @Roles(RoleId.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(emailAutomationStepMeta, "stepId")
  async clearNext(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("stepId") stepId: string) {
    await this.stepService.setNext({ stepId, nextStepId: null });

    // The parent automation's step chain changed with the removed link
    const automationId = await this.stepService.findAutomationId({ stepId });
    if (automationId) await this.cacheService.invalidateByElement(emailAutomationMeta.endpoint, automationId);

    reply.send();
  }
}
