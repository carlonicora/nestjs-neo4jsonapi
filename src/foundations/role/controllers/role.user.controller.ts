import { Controller, Get, Param, Query, Request, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { SecurityService } from "../../../core/security/services/security.service";
import { roleMeta } from "../../role/entities/role.meta";

import { RoleService } from "../../role/services/role.service";
import { userMeta } from "../../user/entities/user.meta";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

@ModuleACL({ module: CoreModuleId.Role })
@Controller(userMeta.endpoint)
export class RoleUserController {
  constructor(
    private readonly roleServide: RoleService,
    private readonly security: SecurityService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get(`:userId/${roleMeta.endpoint}`)
  async findBySearch(
    @Request() req: any,
    @Query() query: any,
    @Param("userId") userId: string,
    @Query("search") search?: string,
    @Query("userNotIn") userNotIn?: boolean,
  ) {
    if (userNotIn)
      return await this.roleServide.findNotInUser({
        userId: userId,
        term: search,
        query: query,
      });

    return await this.roleServide.findForUser({
      userId: userId,
      term: search,
      query: query,
    });
  }
}
