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
import { SystemRoles } from "../../../common/constants/system.roles";
import { Audit } from "../../../common/decorators/audit.decorator";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { ValidateId } from "../../../common/decorators/validate-id.decorator";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import type { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { SkillPostDTO } from "../dtos/skill.post.dto";
import { SkillPutDTO } from "../dtos/skill.put.dto";
import { skillMeta } from "../entities/skill.meta";
import { SkillService } from "../services/skill.service";

/**
 * The company's skills. `skills/active` is open to every authenticated role and never
 * carries `instructions`; every other route is Company Administrator only.
 *
 * Standard CRUD goes through createCrudHandlers: SkillService overrides the inherited
 * find / findById / createFromDTO / putFromDTO / delete with the company rules. `active`,
 * `enable` and `disable` are custom endpoints. `@Roles` sits above `@CacheInvalidate` /
 * `@ValidateId` / `@Audit`: they replace the method, and metadata set below them would
 * never be enforced.
 *
 * Mounted after SkillAdminController so `skills/global` is matched before `skills/:skillId`.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Skill })
@Controller()
export class SkillController {
  private readonly crud = createCrudHandlers(() => this.skillService);

  constructor(
    private readonly skillService: SkillService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(`${skillMeta.endpoint}/active`)
  async findActive(@Res() reply: FastifyReply) {
    reply.send(await this.skillService.findActive());
  }

  @Roles(SystemRoles.CompanyAdministrator)
  @Get(skillMeta.endpoint)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("sort") sort?: string,
  ) {
    return this.crud.findAll(reply, { query, search, sort });
  }

  @Roles(SystemRoles.CompanyAdministrator)
  @Get(`${skillMeta.endpoint}/:skillId`)
  @Audit(skillMeta, "skillId")
  async findById(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("skillId") skillId: string) {
    return this.crud.findById(reply, skillId);
  }

  @Roles(SystemRoles.CompanyAdministrator)
  @Post(skillMeta.endpoint)
  @CacheInvalidate(skillMeta)
  async create(@Res() reply: FastifyReply, @Body() body: SkillPostDTO) {
    return this.crud.create(reply, body);
  }

  @Roles(SystemRoles.CompanyAdministrator)
  @Put(`${skillMeta.endpoint}/:skillId`)
  @ValidateId("skillId")
  @CacheInvalidate(skillMeta, "skillId")
  async update(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: SkillPutDTO) {
    return this.crud.update(reply, body);
  }

  @Roles(SystemRoles.CompanyAdministrator)
  @Delete(`${skillMeta.endpoint}/:skillId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(skillMeta, "skillId")
  async delete(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("skillId") skillId: string) {
    return this.crud.delete(reply, skillId);
  }

  @Roles(SystemRoles.CompanyAdministrator)
  @Post(`${skillMeta.endpoint}/:skillId/enable`)
  @ModuleACL({ module: CoreModuleId.Skill, action: "update" })
  @HttpCode(HttpStatus.OK)
  @CacheInvalidate(skillMeta, "skillId")
  async enable(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("skillId") skillId: string) {
    reply.send(await this.skillService.setEnabled({ id: skillId, enabled: true }));
  }

  @Roles(SystemRoles.CompanyAdministrator)
  @Post(`${skillMeta.endpoint}/:skillId/disable`)
  @ModuleACL({ module: CoreModuleId.Skill, action: "update" })
  @HttpCode(HttpStatus.OK)
  @CacheInvalidate(skillMeta, "skillId")
  async disable(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("skillId") skillId: string) {
    reply.send(await this.skillService.setEnabled({ id: skillId, enabled: false }));
  }
}
