import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import { RoleId } from "../../../common/constants/system.roles";
import { Audit, CacheInvalidate } from "../../../common/decorators";
import { Roles } from "../../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { RolePostDTO } from "../../role/dtos/role.post.dto";
import { roleMeta } from "../../role/entities/role.meta";
import { RoleService } from "../services/role.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

@ModuleACL({ module: CoreModuleId.Role })
@Controller(roleMeta.endpoint)
export class RoleController {
  constructor(
    private readonly roleService: RoleService,
    private readonly auditService: AuditService,
    private readonly cacheService: CacheService,
  ) {}

  @UseGuards(JwtAuthGuard)
  // @Roles(UserRole.Administrator, UserRole.CompanyAdministrator)
  @Get()
  async find(@Query() query: any, @Query("search") search?: string) {
    return await this.roleService.find({ term: search, query: query });
  }

  @UseGuards(JwtAuthGuard)
  // @Roles(UserRole.Administrator, UserRole.CompanyAdministrator)
  @Get(":roleId")
  @Audit(roleMeta, "roleId")
  async findById(@Param("roleId") roleId: string) {
    return await this.roleService.findById({ roleId: roleId });
  }

  // Roles are global (not company-scoped): writing them is a platform operation.
  // @Roles sits above @CacheInvalidate, which replaces the method: metadata set
  // below it would land on the discarded original and never be enforced.
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator)
  @Post()
  @CacheInvalidate(roleMeta)
  async create(@Body() body: RolePostDTO) {
    await this.roleService.expectNotExists({
      name: body.data.attributes.name,
    });

    return await this.roleService.create({
      data: body.data,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator)
  @Put(":roleId")
  @CacheInvalidate(roleMeta, "roleId")
  async update(
    // The request carries the route params @CacheInvalidate reads
    @Req() _req: AuthenticatedRequest,
    @Body() body: RolePostDTO,
    @Param("roleId") roleId: string,
  ) {
    if (roleId !== body.data.id)
      throw new HttpException("Role id does not match the {json:api} id", HttpStatus.PRECONDITION_FAILED);

    return await this.roleService.update({
      data: body.data,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":roleId")
  @CacheInvalidate(roleMeta, "roleId")
  async delete(
    // The request carries the route params @CacheInvalidate reads
    @Req() _req: AuthenticatedRequest,
    @Param("roleId") roleId: string,
  ) {
    await this.roleService.delete({
      roleId: roleId,
    });
  }
}
