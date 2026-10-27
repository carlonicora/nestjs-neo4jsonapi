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
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { SystemRoles } from "../../../common/constants/system.roles";
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
import { EmailBlastPatchDTO } from "../dtos/email-blast.patch.dto";
import { EmailBlastPostDTO } from "../dtos/email-blast.post.dto";
import {
  EMAIL_BLAST_AUDIENCE_SEGMENT,
  EMAIL_BLAST_SEND_SEGMENT,
  EMAIL_BLAST_TEST_SEGMENT,
  emailBlastMeta,
} from "../entities/email-blast.meta";
import { EmailBlastService } from "../services/email-blast.service";

/**
 * Administrator routes over email blasts. JwtAuthGuard enforces @Roles and always admits
 * the Administrator role, so every route is administrator-only.
 *
 * The public unsubscribe route lives in EmailBlastPublicController, so the literal
 * `unsubscribe` segment is never read as `:emailBlastId`.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.EmailBlast })
@Controller()
export class EmailBlastController {
  private readonly crud = createCrudHandlers(() => this.emailBlastService);

  constructor(
    private readonly emailBlastService: EmailBlastService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(emailBlastMeta.endpoint)
  @Roles(SystemRoles.Administrator)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    return this.crud.findAll(reply, { query, search, fetchAll, orderBy });
  }

  @Get(`${emailBlastMeta.endpoint}/:emailBlastId`)
  @Roles(SystemRoles.Administrator)
  @Audit(emailBlastMeta, "emailBlastId")
  async findById(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("emailBlastId") emailBlastId: string,
  ) {
    return this.crud.findById(reply, emailBlastId);
  }

  @Post(emailBlastMeta.endpoint)
  @Roles(SystemRoles.Administrator)
  @CacheInvalidate(emailBlastMeta)
  async create(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: EmailBlastPostDTO) {
    return this.crud.create(reply, body);
  }

  @Patch(`${emailBlastMeta.endpoint}/:emailBlastId`)
  @Roles(SystemRoles.Administrator)
  @ValidateId("emailBlastId")
  @CacheInvalidate(emailBlastMeta, "emailBlastId")
  async patch(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: EmailBlastPatchDTO) {
    return this.crud.patch(reply, body);
  }

  @Delete(`${emailBlastMeta.endpoint}/:emailBlastId`)
  @Roles(SystemRoles.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(emailBlastMeta, "emailBlastId")
  async delete(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("emailBlastId") emailBlastId: string,
  ) {
    return this.crud.delete(reply, emailBlastId);
  }

  @Get(`${emailBlastMeta.endpoint}/:emailBlastId/${EMAIL_BLAST_AUDIENCE_SEGMENT}`)
  @Roles(SystemRoles.Administrator)
  async findAudience(@Res() reply: FastifyReply, @Param("emailBlastId") emailBlastId: string) {
    const response = await this.emailBlastService.findAudience({ id: emailBlastId });
    reply.send(response);
  }

  @Post(`${emailBlastMeta.endpoint}/:emailBlastId/${EMAIL_BLAST_TEST_SEGMENT}`)
  @Roles(SystemRoles.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  async sendTest(@Res() reply: FastifyReply, @Param("emailBlastId") emailBlastId: string) {
    await this.emailBlastService.sendTest({ id: emailBlastId });
    reply.send();
  }

  @Post(`${emailBlastMeta.endpoint}/:emailBlastId/${EMAIL_BLAST_SEND_SEGMENT}`)
  @Roles(SystemRoles.Administrator)
  @CacheInvalidate(emailBlastMeta, "emailBlastId")
  async send(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("emailBlastId") emailBlastId: string,
  ) {
    const response = await this.emailBlastService.send({ id: emailBlastId });
    reply.send(response);
  }
}
