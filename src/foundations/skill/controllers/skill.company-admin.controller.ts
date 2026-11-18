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
import { companyMeta } from "../../company/entities/company.meta";
import { SkillPostDTO } from "../dtos/skill.post.dto";
import { SkillPutDTO } from "../dtos/skill.put.dto";
import { skillMeta } from "../entities/skill.meta";
import { SkillCompanyAdminService } from "../services/skill.company-admin.service";
import { SkillService } from "../services/skill.service";

/** `skills/companies/:companyId`, the Administrator's routes on one company's skills. */
const COMPANY = `${skillMeta.endpoint}/${companyMeta.endpoint}/:companyId`;

/**
 * A picked company's skills, managed by the platform Administrator exactly as that company's
 * Company Administrator manages them in Settings (decision D15 / P11). Every route reads the
 * Company named in the URL (404 on a miss) and then runs the SAME SkillService entry points as
 * SkillController, through createCrudHandlers, with the picked company in context
 * (SkillCompanyAdminService.inCompany). Every company rule therefore applies unchanged.
 *
 * Every route is `@Roles(SystemRoles.Administrator)`, placed above `@CacheInvalidate` /
 * `@ValidateId` / `@Audit`. Mounted before SkillController.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Skill })
@Controller()
export class SkillCompanyAdminController {
  private readonly crud = createCrudHandlers(() => this.skillService);

  constructor(
    private readonly skillService: SkillService,
    private readonly skillCompanyAdminService: SkillCompanyAdminService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Roles(SystemRoles.Administrator)
  @Get(COMPANY)
  async findAll(
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("sort") sort?: string,
  ) {
    return this.skillCompanyAdminService.inCompany({
      companyId,
      run: () => this.crud.findAll(reply, { query, search, sort }),
    });
  }

  @Roles(SystemRoles.Administrator)
  @Get(`${COMPANY}/:skillId`)
  @Audit(skillMeta, "skillId")
  async findById(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
    @Param("skillId") skillId: string,
  ) {
    return this.skillCompanyAdminService.inCompany({
      companyId,
      run: () => this.crud.findById(reply, skillId),
    });
  }

  @Roles(SystemRoles.Administrator)
  @Post(COMPANY)
  @CacheInvalidate(skillMeta)
  async create(@Res() reply: FastifyReply, @Param("companyId") companyId: string, @Body() body: SkillPostDTO) {
    return this.skillCompanyAdminService.inCompany({
      companyId,
      run: () => this.crud.create(reply, body),
    });
  }

  @Roles(SystemRoles.Administrator)
  @Put(`${COMPANY}/:skillId`)
  @ValidateId("skillId")
  @CacheInvalidate(skillMeta, "skillId")
  async update(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
    @Body() body: SkillPutDTO,
  ) {
    return this.skillCompanyAdminService.inCompany({
      companyId,
      run: () => this.crud.update(reply, body),
    });
  }

  @Roles(SystemRoles.Administrator)
  @Delete(`${COMPANY}/:skillId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(skillMeta, "skillId")
  async delete(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
    @Param("skillId") skillId: string,
  ) {
    return this.skillCompanyAdminService.inCompany({
      companyId,
      run: () => this.crud.delete(reply, skillId),
    });
  }

  @Roles(SystemRoles.Administrator)
  @Post(`${COMPANY}/:skillId/enable`)
  @ModuleACL({ module: CoreModuleId.Skill, action: "update" })
  @HttpCode(HttpStatus.OK)
  @CacheInvalidate(skillMeta, "skillId")
  async enable(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
    @Param("skillId") skillId: string,
  ) {
    reply.send(
      await this.skillCompanyAdminService.inCompany({
        companyId,
        run: () => this.skillService.setEnabled({ id: skillId, enabled: true }),
      }),
    );
  }

  @Roles(SystemRoles.Administrator)
  @Post(`${COMPANY}/:skillId/disable`)
  @ModuleACL({ module: CoreModuleId.Skill, action: "update" })
  @HttpCode(HttpStatus.OK)
  @CacheInvalidate(skillMeta, "skillId")
  async disable(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("companyId") companyId: string,
    @Param("skillId") skillId: string,
  ) {
    reply.send(
      await this.skillCompanyAdminService.inCompany({
        companyId,
        run: () => this.skillService.setEnabled({ id: skillId, enabled: false }),
      }),
    );
  }
}
