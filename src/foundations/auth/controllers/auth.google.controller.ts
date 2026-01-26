import { Controller, Get, HttpException, HttpStatus, Query, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FastifyReply } from "fastify";
import { authMeta } from "..";
import { BaseConfigInterface, ConfigGoogleInterface } from "../../../config/interfaces";
import { googleUser } from "../../google-user/types/google.user.type";
import { AuthGoogleService } from "../services/auth.google.service";

@Controller()
export class AuthGoogleController {
  constructor(
    private readonly authGoogleService: AuthGoogleService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  private get googleConfig(): ConfigGoogleInterface {
    return this.configService.get<ConfigGoogleInterface>("google");
  }

  @Get(`${authMeta.endpoint}/google`)
  async loginWithGoogle(@Res() reply: FastifyReply, @Query("invite") inviteCode?: string) {
    if (!this.googleConfig.clientId || !this.googleConfig.clientSecret)
      throw new HttpException("Login with Google is not available", HttpStatus.NOT_IMPLEMENTED);

    reply.redirect(this.authGoogleService.generateLoginUrl(inviteCode), 302);
  }

  @Get(`${authMeta.endpoint}/callback/google`)
  async callbackGoogle(@Res() reply: FastifyReply, @Query("code") code: string, @Query("state") state: string) {
    // Parse invite code from state if present
    const inviteCode = this.authGoogleService.parseInviteCodeFromState(state);

    const accessToken = await this.authGoogleService.exchangeCodeForToken(code);
    const userDetails = await this.authGoogleService.fetchUserDetails(accessToken);

    const redirectUrl = await this.authGoogleService.handleGoogleLogin({
      userDetails: userDetails as googleUser,
      inviteCode,
    });

    reply.redirect(redirectUrl, 302);
  }
}
