import { Controller, Get, HttpException, HttpStatus, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FastifyReply } from "fastify";
import { authMeta } from "..";
import { BaseConfigInterface, ConfigDiscordInterface } from "../../../config/interfaces";
import { discordUser } from "../../discord-user/types/discord.user.type";
import { AuthDiscordService } from "../services/auth.discord.service";

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
  async loginWithDiscord(@Res() reply: FastifyReply, @Query("invite") inviteCode?: string) {
    if (!this.discordConfig.clientId || !this.discordConfig.clientSecret)
      throw new HttpException("Login with Discord is not available", HttpStatus.NOT_IMPLEMENTED);

    reply.redirect(this.authDiscordService.generateLoginUrl(inviteCode), 302);
  }

  @Get(`${authMeta.endpoint}/callback/discord`)
  async callbackDiscord(@Res() reply: FastifyReply, @Req() request: any, @Query("code") code: string, @Query("state") state?: string) {
    // Parse invite code from state if present
    const inviteCode = state ? this.authDiscordService.parseInviteCodeFromState(state) : undefined;

    const accessToken = await this.authDiscordService.exchangeCodeForToken(code);
    const userDetails = await this.authDiscordService.fetchUserDetails(accessToken);

    const redirectUrl = await this.authDiscordService.handleDiscordLogin({
      userDetails: userDetails as discordUser,
      inviteCode,
    });

    reply.redirect(redirectUrl, 302);
  }
}
