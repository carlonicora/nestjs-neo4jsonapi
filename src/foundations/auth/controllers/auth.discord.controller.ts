import { Controller, Get, HttpException, HttpStatus, Query, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FastifyReply } from "fastify";
// Direct file import, NOT the `..` barrel — same import-time cycle as
// auth.google.controller.ts: through the barrel, `authMeta` is undefined when
// the `@Get()` route decorators evaluate.
import { authMeta } from "../entities/auth.meta";
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
  async loginWithDiscord(
    @Res() reply: FastifyReply,
    @Query("invite") inviteCode?: string,
    @Query("referral") referralCode?: string,
  ) {
    if (!this.discordConfig.clientId || !this.discordConfig.clientSecret)
      throw new HttpException("Login with Discord is not available", HttpStatus.NOT_IMPLEMENTED);

    reply.redirect(this.authDiscordService.generateLoginUrl(inviteCode, referralCode), 302);
  }

  @Get(`${authMeta.endpoint}/callback/discord`)
  async callbackDiscord(@Res() reply: FastifyReply, @Query("code") code: string, @Query("state") state?: string) {
    // Parse invite code and referral code from state if present
    const stateData = state ? this.authDiscordService.parseStateData(state) : undefined;
    const inviteCode = stateData?.invite;
    const referralCode = stateData?.referral;

    const accessToken = await this.authDiscordService.exchangeCodeForToken(code);
    const userDetails = await this.authDiscordService.fetchUserDetails(accessToken);

    const redirectUrl = await this.authDiscordService.handleDiscordLogin({
      userDetails: userDetails as discordUser,
      inviteCode,
      referralCode,
    });

    reply.redirect(redirectUrl, 302);
  }
}
