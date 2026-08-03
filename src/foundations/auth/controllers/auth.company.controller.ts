import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import { AnyScopeAuthGuard } from "../../../common/guards/jwt.auth.any-scope.guard";
import { authMeta } from "../../auth/entities/auth.meta";
import { AuthService } from "../../auth/services/auth.service";
import { companyMeta } from "../../company";

/**
 * Company-selection endpoints for company-scoped roles.
 *
 * Deliberately NOT part of AuthController: consumers subclass AuthController to
 * override individual auth flows (e.g. only35's AuthPersonController extends it
 * with an empty @Controller() prefix), and NestJS re-registers every inherited
 * base route under the subclass prefix. A route added to AuthController therefore
 * leaks into subclasses — `@Get("companies")` under an empty prefix collides with
 * CompanyController's root-mounted `GET /companies` and crashes Fastify with
 * FST_ERR_DUPLICATED_ROUTE at boot. Keeping these routes on a dedicated,
 * non-subclassed controller preserves the wire API (/auth/...) without changing
 * what subclasses inherit.
 */
@Controller(authMeta.endpoint)
export class AuthCompanyController {
  constructor(private readonly service: AuthService) {}

  // GET /auth/companies — the companies the caller may act for.
  // AnyScopeAuthGuard because the caller may hold either a full session token
  // (company switcher) or a short-lived company-selection token (login screen).
  @UseGuards(AnyScopeAuthGuard)
  @Get(companyMeta.endpoint)
  async findCompanies() {
    return await this.service.findCompanies();
  }

  // POST /auth/company-selection/:companyId — non-resource operation: exchanges the
  // caller's token for one scoped to the chosen company. Path-param style mirrors
  // POST auth/refreshtoken/:refreshToken, so no DTO is needed.
  @UseGuards(AnyScopeAuthGuard)
  @Post("company-selection/:companyId")
  async selectCompany(@Param("companyId") companyId: string) {
    return await this.service.selectCompany({ companyId: companyId });
  }
}
