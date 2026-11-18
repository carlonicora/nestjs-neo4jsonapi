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
import { SkillAdminService } from "../services/skill.admin.service";
import { SkillService } from "../services/skill.service";

/** `skills/global`, the Administrator's routes. */
const GLOBAL = `${skillMeta.endpoint}/global`;

/**
 * Global skills, managed by the platform Administrator only (decision P2). No company is
 * read from the request: these routes see global skills only, on or off, and answer 404
 * for any other id. Every route is `@Roles(SystemRoles.Administrator)`, placed above
 * `@CacheInvalidate` / `@ValidateId` / `@Audit`.
 *
 * Standard CRUD goes through createCrudHandlers on SkillAdminService, whose inherited
 * entry points map to the global-skill methods; `enable` and `disable` are custom endpoints.
 *
 * Mounted before SkillController so `skills/global` is never read as a `skills/:skillId`.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Skill })
@Controller()
export class SkillAdminController {
  private readonly crud = createCrudHandlers(() => this.skillAdminService);

  constructor(
    private readonly skillService: SkillService,
    private readonly skillAdminService: SkillAdminService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Roles(SystemRoles.Administrator)
  @Get(GLOBAL)
  async findAll(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("sort") sort?: string,
  ) {
    return this.crud.findAll(reply, { query, search, sort });
  }

  @Roles(SystemRoles.Administrator)
  @Get(`${GLOBAL}/:skillId`)
  @Audit(skillMeta, "skillId")
  async findById(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("skillId") skillId: string) {
    return this.crud.findById(reply, skillId);
  }

  @Roles(SystemRoles.Administrator)
  @Post(GLOBAL)
  @CacheInvalidate(skillMeta)
  async create(@Res() reply: FastifyReply, @Body() body: SkillPostDTO) {
    return this.crud.create(reply, body);
  }

  @Roles(SystemRoles.Administrator)
  @Put(`${GLOBAL}/:skillId`)
  @ValidateId("skillId")
  @CacheInvalidate(skillMeta, "skillId")
  async update(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: SkillPutDTO) {
    return this.crud.update(reply, body);
  }

  @Roles(SystemRoles.Administrator)
  @Delete(`${GLOBAL}/:skillId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(skillMeta, "skillId")
  async delete(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("skillId") skillId: string) {
    return this.crud.delete(reply, skillId);
  }

  @Roles(SystemRoles.Administrator)
  @Post(`${GLOBAL}/:skillId/enable`)
  @ModuleACL({ module: CoreModuleId.Skill, action: "update" })
  @HttpCode(HttpStatus.OK)
  @CacheInvalidate(skillMeta, "skillId")
  async enable(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("skillId") skillId: string) {
    reply.send(await this.skillService.setGlobalActive({ id: skillId, active: true }));
  }

  @Roles(SystemRoles.Administrator)
  @Post(`${GLOBAL}/:skillId/disable`)
  @ModuleACL({ module: CoreModuleId.Skill, action: "update" })
  @HttpCode(HttpStatus.OK)
  @CacheInvalidate(skillMeta, "skillId")
  async disable(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("skillId") skillId: string) {
    reply.send(await this.skillService.setGlobalActive({ id: skillId, active: false }));
  }
}
