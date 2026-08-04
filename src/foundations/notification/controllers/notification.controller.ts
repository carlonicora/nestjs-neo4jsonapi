import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";

import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { CacheService } from "../../../core/cache/services/cache.service";
import { NotificationDataPatchDTO, NotificationPatchListDTO } from "../../notification/dtos/notification.patch.dto";
import { notificationMeta } from "../../notification/entities/notification.meta";
import { NotificationServices } from "../../notification/services/notification.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class NotificationController {
  constructor(
    private readonly service: NotificationServices,
    private readonly cacheService: CacheService,
  ) {}

  @Get(notificationMeta.endpoint)
  async findList(@Req() request: any, @Query() query: any, @Query("isArchived") isArchived?: boolean) {
    return await this.service.findForUser({ query: query, userId: request.user.userId, isArchived: isArchived });
  }

  @Get(`${notificationMeta.endpoint}/:notificationId`)
  async findById(@Req() request: any, @Param("notificationId") notificationId: string) {
    return await this.service.findByIdForUser({ notificationId: notificationId, userId: request.user.id });
  }

  @Patch(notificationMeta.endpoint)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(notificationMeta, "notificationId")
  async markAsRead(@Req() request: any, @Query() query: any, @Body() body: NotificationPatchListDTO) {
    return await this.service.markAsRead({
      userId: request.user.userId,
      notificationIds: body.data.map((notification: NotificationDataPatchDTO) => notification.id),
    });
  }

  @Post(`${notificationMeta.endpoint}/:notificationId/archive`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(notificationMeta, "notificationId")
  async archive(@Req() request: any, @Query() query: any, @Param("notificationId") notificationId: string) {
    await this.service.archive({
      notificationId: notificationId,
    });
  }
}
