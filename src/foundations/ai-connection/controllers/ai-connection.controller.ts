import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { RoleId } from "../../../common/constants/system.roles";
import { Roles } from "../../../common/decorators";
import { Audit } from "../../../common/decorators/audit.decorator";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { AdminJwtAuthGuard, JwtAuthGuard } from "../../../common/guards";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { AiConnectionPostDTO } from "../dtos/ai-connection.post.dto";
import { AiConnectionPutDTO } from "../dtos/ai-connection.put.dto";
import { AiConnectionReorderDTO } from "../dtos/ai-connection.reorder.dto";
import { aiConnectionMeta } from "../entities/ai-connection.meta";
import { AiConnectionService } from "../services/ai-connection.service";

/**
 * AiConnectionController
 *
 * Administrative REST API for the AI connection fallback chains. Mirrors the
 * in-package admin-controller canonical (`stripe-product.controller.ts`):
 * reads are `JwtAuthGuard` + `@Roles`, mutations are `AdminJwtAuthGuard` +
 * `@Roles(RoleId.Administrator)`.
 *
 * Create/update deliberately call the service rather than
 * `createCrudHandlers()`: both need service-level registry validation and
 * secret encryption before the generic DTO path runs.
 */
@Controller()
export class AiConnectionController {
  constructor(
    private readonly aiConnectionService: AiConnectionService,
    // Read by the @CacheInvalidate / @Audit decorators via `this` — without
    // these injections both decorators silently no-op.
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(aiConnectionMeta.endpoint)
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator)
  async findAll(@Res() reply: FastifyReply, @Query() query: any) {
    const response = await this.aiConnectionService.findAllWithMeta({ query });
    reply.send(response);
  }

  @Get(`${aiConnectionMeta.endpoint}/:id`)
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator)
  @Audit(aiConnectionMeta, "id")
  async findById(@Res() reply: FastifyReply, @Param("id") id: string) {
    const response = await this.aiConnectionService.findById({ id });
    reply.send(response);
  }

  // Type-wide @CacheInvalidate on every mutation (not the per-id form): the
  // per-id variant extracts req.params from the method's arguments, and these
  // signatures — (reply, id, body) — carry no object with a `params` property,
  // so it would silently invalidate nothing. invalidateByType clears every
  // cache key registered to any element of the type, list responses included.
  @Post(`${aiConnectionMeta.endpoint}/reorder`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @CacheInvalidate(aiConnectionMeta)
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorder(@Res() reply: FastifyReply, @Body() body: AiConnectionReorderDTO) {
    await this.aiConnectionService.reorder({ ids: body.data.ids });
    // @HttpCode is inert with an injected @Res — set the status explicitly.
    reply.status(HttpStatus.NO_CONTENT).send();
  }

  @Post(aiConnectionMeta.endpoint)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @CacheInvalidate(aiConnectionMeta)
  async create(@Res() reply: FastifyReply, @Body() body: AiConnectionPostDTO) {
    const response = await this.aiConnectionService.create(body);
    reply.status(HttpStatus.CREATED).send(response);
  }

  @Put(`${aiConnectionMeta.endpoint}/:id`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @CacheInvalidate(aiConnectionMeta)
  async update(@Res() reply: FastifyReply, @Param("id") id: string, @Body() body: AiConnectionPutDTO) {
    // JSONAPI validation: URL ID must match body ID
    if (id !== body.data.id) {
      reply.status(HttpStatus.PRECONDITION_FAILED).send({ error: "AiConnection id does not match the {json:api} id" });
      return;
    }

    const response = await this.aiConnectionService.update(body);
    reply.send(response);
  }

  @Delete(`${aiConnectionMeta.endpoint}/:id`)
  @UseGuards(AdminJwtAuthGuard)
  @Roles(RoleId.Administrator)
  @CacheInvalidate(aiConnectionMeta)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Res() reply: FastifyReply, @Param("id") id: string) {
    await this.aiConnectionService.deleteConnection({ id });
    // @HttpCode is inert with an injected @Res — set the status explicitly.
    reply.status(HttpStatus.NO_CONTENT).send();
  }
}
