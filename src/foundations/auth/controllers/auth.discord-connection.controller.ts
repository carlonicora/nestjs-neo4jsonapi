import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { Audit } from "../../../common/decorators/audit.decorator";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { NoCache } from "../../../core/cache/interceptors/cache.interceptor";
import { CacheService } from "../../../core/cache/services/cache.service";
import { AuditService } from "../../audit/services/audit.service";
import { DiscordConnectConfirmationPostDTO } from "../dtos/discord-connect-confirmation.post.dto";
import { DiscordConnectIntentPostDTO } from "../dtos/discord-connect-intent.post.dto";
import { discordConnectConfirmationMeta } from "../entities/discord-connect-confirmation.meta";
import { discordConnectIntentMeta } from "../entities/discord-connect-intent.meta";
import { discordConnectionMeta } from "../entities/discord-connection.meta";
import { DiscordConnectIntentService } from "../services/discord-connect-intent.service";
import { DiscordConnectionService } from "../services/discord-connection.service";

/**
 * Discord connect for a signed-in user: the connection status, the start of a connect (intent) and
 * its confirmation. The launch route and the OAuth callback are unguarded and live in AuthDiscordController.
 */
@ModuleACL({ module: CoreModuleId.Auth })
@UseGuards(JwtAuthGuard)
@Controller()
export class AuthDiscordConnectionController {
  private readonly crud = createCrudHandlers(() => this.discordConnectionService);

  constructor(
    private readonly discordConnectionService: DiscordConnectionService,
    private readonly discordConnectIntentService: DiscordConnectIntentService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  // No cache: the link is written by the confirmations route, a different resource.
  @Get(`${discordConnectionMeta.endpoint}/:discordConnectionId`)
  @NoCache()
  @Audit(discordConnectionMeta, "discordConnectionId")
  async findById(
    @Req() _req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("discordConnectionId") discordConnectionId: string,
  ) {
    return this.crud.findById(reply, discordConnectionId);
  }

  @Post(discordConnectIntentMeta.endpoint)
  @CacheInvalidate(discordConnectIntentMeta)
  async createIntent(@Res() reply: FastifyReply, @Body() body: DiscordConnectIntentPostDTO) {
    const { document, cookie } = await this.discordConnectIntentService.create({
      id: body.data.id,
      returnPath: body.data.attributes.returnPath,
    });

    reply.header("Set-Cookie", cookie);
    reply.send(document);
  }

  @Post(discordConnectConfirmationMeta.endpoint)
  @CacheInvalidate(discordConnectConfirmationMeta)
  async createConfirmation(@Res() reply: FastifyReply, @Body() body: DiscordConnectConfirmationPostDTO) {
    const document = await this.discordConnectIntentService.confirm({ confirmToken: body.data.id });
    reply.send(document);
  }
}
