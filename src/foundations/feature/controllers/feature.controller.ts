import { RoleId } from "../../../common/constants/system.roles";
import { Controller, Get, Query, Request, UseGuards } from "@nestjs/common";
import { Roles } from "../../../common/decorators/roles.decorator";

import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { featureMeta } from "../../feature/entities/feature.meta";
import { FeatureService } from "../../feature/services/feature.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

@ModuleACL({ module: CoreModuleId.Feature })
@Controller(featureMeta.endpoint)
export class FeatureController {
  constructor(private readonly featureService: FeatureService) {}

  @UseGuards(AdminJwtAuthGuard, JwtAuthGuard)
  @Get()
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
  async findBySearch(@Request() req: any, @Query() query: any, @Query("search") search?: string) {
    return await this.featureService.find({ query: query, term: search });
  }
}
