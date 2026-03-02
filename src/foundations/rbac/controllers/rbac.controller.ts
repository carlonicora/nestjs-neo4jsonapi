import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { Roles } from "../../../common/decorators/roles.decorator";
import { RoleId } from "../../../common/constants/system.roles";
import { RbacService } from "../services/rbac.service";
import { permissionMappingMeta } from "../entities/permission-mapping.meta";

@Controller(permissionMappingMeta.endpoint)
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @UseGuards(AdminJwtAuthGuard, JwtAuthGuard)
  @Get()
  @Roles(RoleId.Administrator)
  async findPermissionMappings() {
    return await this.rbacService.findPermissionMappings();
  }
}
