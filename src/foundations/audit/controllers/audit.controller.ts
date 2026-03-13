import { Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { auditLogMeta } from "../entities/audit.meta";
import { AuditService } from "../services/audit.service";
import { userMeta } from "../../user/entities/user.meta";

@UseGuards(JwtAuthGuard)
@Controller()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get(`${auditLogMeta.endpoint}/activity/:entityType/:entityId`)
  async findActivityByEntity(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Param("entityType") entityType: string,
    @Param("entityId") entityId: string,
  ) {
    const response = await this.auditService.findActivityByEntity({
      entityType,
      entityId,
      query,
    });

    reply.send(response);
  }

  @Get(`${auditLogMeta.endpoint}/:entityType/:entityId`)
  async findByEntity(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Param("entityType") entityType: string,
    @Param("entityId") entityId: string,
  ) {
    const response = await this.auditService.findByEntity({
      entityType,
      entityId,
      query,
    });

    reply.send(response);
  }

  @Get(`${userMeta.endpoint}/:userId/${auditLogMeta.endpoint}`)
  async findByUser(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Param("userId") userId: string,
  ) {
    const response = await this.auditService.findByUser({
      userId,
      query,
    });

    reply.send(response);
  }
}
