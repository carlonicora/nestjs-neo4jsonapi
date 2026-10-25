import { Controller, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { RoleId } from "../../../common/constants/system.roles";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { companyMeta } from "../../company/entities/company.meta";
import { CREDIT_WARNING_DISMISS_SEGMENT } from "../interfaces/credit-warning.interface";
import { CreditWarningService } from "../services/credit-warning.service";

/**
 * Credit warning routes. Company administrators only.
 *
 * With `billing.creditWarning` off the dismiss route still answers 204 and writes nothing.
 */
@ModuleACL({ module: CoreModuleId.Billing })
@Controller()
export class CreditWarningController {
  constructor(
    private readonly creditWarningService: CreditWarningService,
    private readonly cacheService: CacheService,
  ) {}

  // POST /companies/:companyId/credit-warning/dismiss
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.CompanyAdministrator)
  @Post(`${companyMeta.endpoint}/:companyId/${CREDIT_WARNING_DISMISS_SEGMENT}`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(companyMeta, "companyId")
  async dismiss(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply, @Param("companyId") companyId: string) {
    await this.creditWarningService.dismiss({ companyId });
    reply.send();
  }
}
