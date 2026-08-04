import { Controller, Get, HttpException, HttpStatus, Query, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FastifyReply } from "fastify";
// Direct file import, NOT the `..` barrel: the barrel now exports this
// controller, so importing back through it creates a cycle in which
// `authMeta` is still uninitialised when the `@Get()` decorators evaluate
// ("Cannot read properties of undefined (reading 'endpoint')" at import time).
import { authMeta } from "../entities/auth.meta";
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
  async loginWithGoogle(
    @Res() reply: FastifyReply,
    @Query("invite") inviteCode?: string,
    @Query("referral") referralCode?: string,
  ) {
    if (!this.googleConfig.clientId || !this.googleConfig.clientSecret)
      throw new HttpException("Login with Google is not available", HttpStatus.NOT_IMPLEMENTED);

    reply.redirect(this.authGoogleService.generateLoginUrl(inviteCode, referralCode), 302);
  }

  @Get(`${authMeta.endpoint}/callback/google`)
  async callbackGoogle(@Res() reply: FastifyReply, @Query("code") code: string, @Query("state") state: string) {
    // Parse invite code and referral code from state if present
    const stateData = this.authGoogleService.parseStateData(state);
    const inviteCode = stateData?.invite;
    const referralCode = stateData?.referral;

    const accessToken = await this.authGoogleService.exchangeCodeForToken(code);
    const userDetails = await this.authGoogleService.fetchUserDetails(accessToken);

    const redirectUrl = await this.authGoogleService.handleGoogleLogin({
      userDetails: userDetails as googleUser,
      inviteCode,
      referralCode,
    });

    reply.redirect(redirectUrl, 302);
  }
}
