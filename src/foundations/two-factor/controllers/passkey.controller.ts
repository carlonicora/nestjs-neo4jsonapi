import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";

import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { PasskeyRegistrationOptionsDTO } from "../dtos/passkey-options.dto";
import { PasskeyRegistrationVerifyDTO, PasskeyRenameDTO } from "../dtos/passkey-verify.dto";
import { passkeyMeta } from "../entities/passkey.meta";
import { PasskeyService } from "../services/passkey.service";
import { TwoFactorService } from "../services/two-factor.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

/**
 * Passkey Controller
 *
 * Handles passkey (WebAuthn) registration and management.
 * All endpoints require JWT authentication.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.User })
@Controller("auth")
export class PasskeyController {
  constructor(
    private readonly passkeyService: PasskeyService,
    private readonly twoFactorService: TwoFactorService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * POST /auth/passkey/register/options
   *
   * Generate WebAuthn registration options for creating a new passkey.
   * Returns options to be passed to navigator.credentials.create().
   */
  @ModuleACL({ module: CoreModuleId.User, action: "update" })
  @Post("passkey/register/options")
  async getRegistrationOptions(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: PasskeyRegistrationOptionsDTO,
  ) {
    const userId = req.user.userId;
    const { userName, userDisplayName } = body.data.attributes;

    const response = await this.passkeyService.generateRegistrationOptions({
      userId,
      userName,
      userDisplayName: userDisplayName || userName,
    });

    reply.send(response);
  }

  /**
   * POST /auth/passkey/register/verify
   *
   * Verify and register a new passkey after the user completes
   * the WebAuthn ceremony on their device.
   */
  @ModuleACL({ module: CoreModuleId.User, action: "update" })
  @Post("passkey/register/verify")
  async verifyRegistration(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: PasskeyRegistrationVerifyDTO,
  ) {
    const { pendingId, name, response } = body.data.attributes;

    const result = await this.passkeyService.verifyRegistration({
      pendingId,
      name,
      response: response as any,
    });

    reply.send(result);
  }

  /**
   * GET /auth/passkeys
   *
   * List all passkeys for the authenticated user.
   * Returns passkey info without sensitive data (public keys).
   */
  @Get("passkeys")
  async listPasskeys(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const userId = req.user.userId;
    const response = await this.passkeyService.listPasskeys({ userId });
    reply.send(response);
  }

  /**
   * DELETE /auth/passkeys/:id
   *
   * Delete a passkey.
   * If this is the last 2FA method, 2FA will be automatically disabled.
   */
  @ModuleACL({ module: CoreModuleId.User, action: "update" })
  @Delete("passkeys/:passkeyId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(passkeyMeta, "passkeyId")
  async deletePasskey(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("passkeyId") passkeyId: string,
  ) {
    await this.passkeyService.removePasskey({ passkeyId });

    // Check if 2FA should be disabled (no methods remaining)
    const userId = req.user.userId;
    await this.twoFactorService.checkAndDisableIfNoMethods(userId);

    reply.send();
  }

  /**
   * PATCH /auth/passkeys/:id
   *
   * Rename a passkey.
   */
  @ModuleACL({ module: CoreModuleId.User, action: "update" })
  @Patch("passkeys/:passkeyId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(passkeyMeta, "passkeyId")
  async renamePasskey(
    @Res() reply: FastifyReply,
    @Param("passkeyId") passkeyId: string,
    @Body() body: PasskeyRenameDTO,
  ) {
    const { name } = body.data.attributes;

    await this.passkeyService.renamePasskey({
      passkeyId,
      name,
    });

    reply.send();
  }
}
