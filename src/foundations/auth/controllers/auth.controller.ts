import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { FastifyReply } from "fastify";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthPostForgotDTO } from "../../auth/dtos/auth.post.forgot.dto";
import { AuthPostLoginDTO } from "../../auth/dtos/auth.post.login.dto";
import { AuthPostRegisterDTO } from "../../auth/dtos/auth.post.register.dto";
import { AuthPostResetPasswordDTO } from "../../auth/dtos/auth.post.resetpassword.dto";
import { authMeta } from "../../auth/entities/auth.meta";
import { AuthService } from "../../auth/services/auth.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { Audit } from "../../../common/decorators/audit.decorator";
import { AuditService } from "../../audit/services/audit.service";
import { pendingRegistrationMeta } from "../entities/pending-registration.meta";

@ModuleACL({ module: CoreModuleId.Auth })
@Controller(authMeta.endpoint)
export class AuthController {
  // auditService is optional: consumers subclass this controller with super(authService).
  constructor(
    private readonly service: AuthService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

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

  // NOTE: the company-selection endpoints (GET /auth/companies and
  // POST /auth/company-selection/:companyId) live on AuthCompanyController, NOT
  // here: consumers subclass AuthController under their own prefix and inherit
  // every route declared on it — see auth.company.controller.ts.

  @UseGuards(JwtAuthGuard)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSinglAuth(@Req() request: any) {
    const token: string = (request.headers.authorization as string).split("Bearer ")[1];
    return await this.service.deleteByToken({ token: token });
  }

  @Throttle({ default: { limit: 5, ttl: 60000 }, ip: { limit: 5, ttl: 60000 } })
  @Post("login")
  async login(@Body() body: AuthPostLoginDTO) {
    return this.service.login({ data: body.data });
  }

  @Throttle({ default: { limit: 3, ttl: 60000 }, ip: { limit: 3, ttl: 60000 } })
  @Post("register")
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(@Body() body: AuthPostRegisterDTO) {
    // MUST be awaited — see acceptInvitation below for the full rationale.
    // Unawaited, the 204 is sent before the promise settles, so the duplicate
    // email 409 that UserService.expectNotExists raises never reaches the
    // response: the caller always sees the confirmation card, registered or
    // not, and the error is lost as an unhandled rejection.
    await this.service.register({ data: body.data });
  }

  @Throttle({ default: { limit: 3, ttl: 60000 }, ip: { limit: 3, ttl: 60000 } })
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

  @Throttle({ default: { limit: 3, ttl: 60000 }, ip: { limit: 3, ttl: 60000 } })
  @Post("reset/:code")
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() body: AuthPostResetPasswordDTO, @Param("code") code: string) {
    // MUST be awaited — see acceptInvitation below. Unawaited, an invalid or
    // expired code still returns 204 and the user is told their password was
    // changed when it was not.
    await this.service.resetPassword(code, body.data.attributes.password);
  }

  @Post("invitation/:code")
  @HttpCode(HttpStatus.NO_CONTENT)
  async acceptInvitation(@Body() body: AuthPostResetPasswordDTO, @Param("code") code: string) {
    // MUST be awaited. Without it the 204 is sent before the promise settles,
    // so every failure the service raises — invalid code, expired code — is
    // lost as an unhandled rejection and the invitee is told their password was
    // set when it was not. The handler is declared `async` and the response
    // code is fixed by @HttpCode, so awaiting changes nothing on success.
    await this.service.acceptInvitation(code, body.data.attributes.password);
  }

  @Post("activate/:code")
  @HttpCode(HttpStatus.NO_CONTENT)
  async activateAccount(@Param("code") code: string, @Headers("x-language") language?: string) {
    await this.service.activateAccount(code, language);
  }

  // Public: the pending id is an unguessable UUID that expires after 15 minutes.
  @Throttle({ default: { limit: 10, ttl: 60000 }, ip: { limit: 10, ttl: 60000 } })
  @Get(`oauth/${pendingRegistrationMeta.endpoint}/:pendingId`)
  @Audit(pendingRegistrationMeta, "pendingId")
  async findPendingRegistration(
    // The request carries the route param @Audit reads.
    @Req() _req: any,
    @Res() reply: FastifyReply,
    @Param("pendingId") pendingId: string,
  ) {
    const response = await this.service.findPendingRegistration({ pendingId });
    reply.send(response);
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
    @Headers("x-language") language?: string,
  ): Promise<{ code: string }> {
    return this.service.completeOAuthRegistration(body, language);
  }
}
