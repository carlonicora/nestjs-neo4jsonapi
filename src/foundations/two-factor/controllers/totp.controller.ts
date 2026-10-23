import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";

import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { TotpSetupDTO } from "../dtos/totp-setup.dto";
import { TotpSetupVerifyDTO } from "../dtos/totp-verify.dto";
import { totpAuthenticatorMeta } from "../entities/totp-authenticator.meta";
import { TotpService } from "../services/totp.service";
import { TwoFactorService } from "../services/two-factor.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

/**
 * TOTP Controller
 *
 * Handles TOTP authenticator management (setup, verification, listing, deletion).
 * All endpoints require JWT authentication.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.User })
@Controller("auth/totp")
export class TotpController {
  constructor(
    private readonly totpService: TotpService,
    private readonly twoFactorService: TwoFactorService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * POST /auth/totp/setup
   *
   * Start TOTP authenticator setup.
   * Returns a QR code and secret for the authenticator app.
   * The authenticator is created in unverified state until verify-setup is called.
   */
  @ModuleACL({ module: CoreModuleId.User, action: "update" })
  @Post("setup")
  async setup(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: TotpSetupDTO) {
    const userId = req.user.userId;
    const { name, accountName } = body.data.attributes;

    const response = await this.totpService.generateSecret({
      userId,
      name,
      accountName,
    });

    reply.send(response);
  }

  /**
   * POST /auth/totp/verify-setup
   *
   * Verify and activate a newly set up TOTP authenticator.
   * The user must provide a valid TOTP code from their authenticator app.
   */
  @ModuleACL({ module: CoreModuleId.User, action: "update" })
  @Post("verify-setup")
  async verifySetup(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: TotpSetupVerifyDTO) {
    const { authenticatorId, code } = body.data.attributes;
    const response = await this.totpService.addAuthenticator({
      authenticatorId,
      code,
    });

    reply.send(response);
  }

  /**
   * GET /auth/totp/authenticators
   *
   * List all TOTP authenticators for the authenticated user.
   * Returns authenticator info without sensitive data (secrets).
   */
  @Get("authenticators")
  async listAuthenticators(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const userId = req.user.userId;
    const response = await this.totpService.listAuthenticators({ userId });
    reply.send(response);
  }

  /**
   * DELETE /auth/totp/authenticators/:id
   *
   * Delete a TOTP authenticator.
   * If this is the last 2FA method, 2FA will be automatically disabled.
   */
  @ModuleACL({ module: CoreModuleId.User, action: "update" })
  @Delete("authenticators/:authenticatorId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(totpAuthenticatorMeta, "authenticatorId")
  async deleteAuthenticator(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("authenticatorId") authenticatorId: string,
  ) {
    await this.totpService.removeAuthenticator({ authenticatorId });

    // Check if 2FA should be disabled (no methods remaining)
    const userId = req.user.userId;
    await this.twoFactorService.checkAndDisableIfNoMethods(userId);

    reply.send();
  }
}
