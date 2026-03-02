import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { Roles } from "../../../common/decorators/roles.decorator";
import { RoleId } from "../../../common/constants/system.roles";
import { RbacService } from "../services/rbac.service";
import { modulePathsMeta } from "../entities/module-paths.meta";

@Controller(modulePathsMeta.endpoint)
export class RbacModulePathsController {
  constructor(private readonly rbacService: RbacService) {}

  @UseGuards(AdminJwtAuthGuard, JwtAuthGuard)
  @Get()
  @Roles(RoleId.Administrator)
  async findModuleRelationshipPaths() {
    return await this.rbacService.findModuleRelationshipPaths();
  }
}
