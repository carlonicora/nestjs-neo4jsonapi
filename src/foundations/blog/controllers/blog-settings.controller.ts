import { Body, Controller, Get, Put, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { RoleId } from "../../../common/constants/system.roles";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { ValidateId } from "../../../common/decorators/validate-id.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import type { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { BlogSettingsPutDTO } from "../dtos/blog-settings.put.dto";
import { blogSettingsMeta } from "../entities/blog-settings.meta";
import { BlogSettingsService } from "../services/blog-settings.service";

/**
 * Admin surface for the blog's singleton settings (the public list layout).
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Blog })
@Controller()
export class BlogSettingsController {
  constructor(
    private readonly blogSettingsService: BlogSettingsService,
    private readonly cacheService: CacheService,
  ) {}

  @Roles(RoleId.Administrator)
  @Get(blogSettingsMeta.endpoint)
  async find(@Res() reply: FastifyReply) {
    const response = await this.blogSettingsService.getSettings();
    reply.send(response);
  }

  @Roles(RoleId.Administrator)
  @Put(`${blogSettingsMeta.endpoint}/:blogSettingsId`)
  @ValidateId("blogSettingsId")
  @CacheInvalidate(blogSettingsMeta, "blogSettingsId")
  async update(@Req() request: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: BlogSettingsPutDTO) {
    const response = await this.blogSettingsService.saveSettings({ data: body.data });
    reply.send(response);
  }
}
