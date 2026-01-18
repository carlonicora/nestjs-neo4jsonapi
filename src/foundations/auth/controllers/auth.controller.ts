import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthPostForgotDTO } from "../../auth/dtos/auth.post.forgot.dto";
import { AuthPostLoginDTO } from "../../auth/dtos/auth.post.login.dto";
import { AuthPostRegisterDTO } from "../../auth/dtos/auth.post.register.dto";
import { AuthPostResetPasswordDTO } from "../../auth/dtos/auth.post.resetpassword.dto";
import { authMeta } from "../../auth/entities/auth.meta";
import { AuthService } from "../../auth/services/auth.service";

@Controller(authMeta.endpoint)
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post()
  async findAuth(@Query("code") code: string) {
    return await this.service.findAuthByCode({ code: code });
  }

  @Post("refreshtoken/:refreshToken")
  async refreshToken(@Param("refreshToken") refreshToken: string) {
    return await this.service.refreshToken({
      refreshToken: refreshToken,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSinglAuth(@Req() request: any) {
    const token: string = (request.headers.authorization as string).split("Bearer ")[1];
    return await this.service.deleteByToken({ token: token });
  }

  @Post("login")
  async login(@Body() body: AuthPostLoginDTO) {
    return this.service.login({ data: body.data });
  }

  @Post("register")
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(@Body() body: AuthPostRegisterDTO) {
    this.service.register({ data: body.data });
  }

  @Post("forgot")
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() body: AuthPostForgotDTO, @Query("lng") lng?: string) {
    return this.service.startResetPassword(body.data.attributes.email.toLowerCase(), lng);
  }

  @Get("validate/:code")
  @HttpCode(HttpStatus.NO_CONTENT)
  async validateResetCode(@Param("code") code: string) {
    await this.service.validateCode(code);
  }

  @Post("reset/:code")
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() body: AuthPostResetPasswordDTO, @Param("code") code: string) {
    this.service.resetPassword(code, body.data.attributes.password);
  }

  @Post("invitation/:code")
  @HttpCode(HttpStatus.NO_CONTENT)
  async acceptInvitation(@Body() body: AuthPostResetPasswordDTO, @Param("code") code: string) {
    this.service.acceptInvitation(code, body.data.attributes.password);
  }

  @Post("activate/:code")
  @HttpCode(HttpStatus.NO_CONTENT)
  async activateAccount(@Param("code") code: string) {
    await this.service.activateAccount(code);
  }

  @Post("oauth/complete")
  async completeOAuthRegistration(
    @Body()
    body: {
      pendingId: string;
      termsAcceptedAt: string;
      marketingConsent: boolean;
      marketingConsentAt: string | null;
    },
  ): Promise<{ code: string }> {
    return this.service.completeOAuthRegistration(body);
  }
}
