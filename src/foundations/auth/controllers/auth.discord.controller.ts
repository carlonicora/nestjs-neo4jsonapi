import { Controller, Get, HttpException, HttpStatus, Param, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FastifyReply, FastifyRequest } from "fastify";
// Direct file import, NOT the `..` barrel — same import-time cycle as
// auth.google.controller.ts: through the barrel, `authMeta` is undefined when
// the `@Get()` route decorators evaluate.
import { authMeta } from "../entities/auth.meta";
import { discordConnectIntentMeta } from "../entities/discord-connect-intent.meta";
import { BaseConfigInterface, ConfigDiscordInterface } from "../../../config/interfaces";
import { discordUser } from "../../discord-user/types/discord.user.type";
import { AuthDiscordService } from "../services/auth.discord.service";

/** Reads the `discord_connect` browser-binding cookie (no cookie plugin is registered). */
function readConnectCookie(request?: FastifyRequest): string | undefined {
  const header = request?.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === "discord_connect") {
      const value = part.slice(separator + 1).trim();
      return value || undefined;
    }
  }
  return undefined;
}

@Controller()
export class AuthDiscordController {
  constructor(
    private readonly authDiscordService: AuthDiscordService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  private get discordConfig(): ConfigDiscordInterface {
    return this.configService.get<ConfigDiscordInterface>("discord");
  }

  @Get(`${authMeta.endpoint}/discord`)
  async loginWithDiscord(
    @Res() reply: FastifyReply,
    @Query("invite") inviteCode?: string,
    @Query("referral") referralCode?: string,
    @Query("source") source?: string,
    @Query("pass") pass?: string,
  ) {
    if (!this.discordConfig.clientId || !this.discordConfig.clientSecret)
      throw new HttpException("Login with Discord is not available", HttpStatus.NOT_IMPLEMENTED);

    reply.redirect(this.authDiscordService.generateLoginUrl(inviteCode, referralCode, source, pass), 302);
  }

  /**
   * The launch route of a Discord connect (top-level navigation: no login token, but the browser
   * carries the `discord_connect` cookie set when the intent was created).
   */
  @Get(`${discordConnectIntentMeta.endpoint}/:discordConnectIntentId/authorize`)
  async launchConnect(
    @Res() reply: FastifyReply,
    @Param("discordConnectIntentId") discordConnectIntentId: string,
    @Req() request: FastifyRequest,
  ) {
    const redirectUrl = await this.authDiscordService.launchConnect({
      code: discordConnectIntentId,
      browserKey: readConnectCookie(request),
    });

    reply.redirect(redirectUrl, 302);
  }

  @Get(`${authMeta.endpoint}/callback/discord`)
  async callbackDiscord(
    @Res() reply: FastifyReply,
    @Query("code") code: string,
    @Query("state") state?: string,
    @Req() request?: FastifyRequest,
  ) {
    // Parse invite code and referral code from state if present
    const stateData = state ? this.authDiscordService.parseStateData(state) : undefined;

    // A Discord connect: links nothing here, always clears the browser cookie.
    if (stateData?.connect) {
      const connectUrl = await this.authDiscordService.handleDiscordConnectCallback({
        code: stateData.connect,
        discordCode: code,
        browserKey: readConnectCookie(request),
      });

      reply.header("Set-Cookie", this.authDiscordService.connectCookie({ value: "", maxAge: 0 }));
      reply.redirect(connectUrl, 302);
      return;
    }

    const inviteCode = stateData?.invite;
    const referralCode = stateData?.referral;
    const source = stateData?.source;
    const pass = stateData?.pass;

    const accessToken = await this.authDiscordService.exchangeCodeForToken(code);
    const userDetails = await this.authDiscordService.fetchUserDetails(accessToken);

    const redirectUrl = await this.authDiscordService.handleDiscordLogin({
      userDetails: userDetails as discordUser,
      inviteCode,
      referralCode,
      source,
      pass,
    });

    reply.redirect(redirectUrl, 302);
  }
}
