import { Body, Controller, forwardRef, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AuthService } from "../../auth/services/auth.service";
import { BackupCodeVerifyDTO } from "../dtos/two-factor-verify.dto";
import { TwoFactorChallengeDTO } from "../dtos/two-factor-verify.dto";
import { TwoFactorEnableDTO } from "../dtos/two-factor-verify.dto";
import { TotpVerifyDTO } from "../dtos/totp-verify.dto";
import { PasskeyAuthenticationVerifyDTO } from "../dtos/passkey-verify.dto";
import { TwoFactorChallengeDescriptor } from "../entities/two-factor-challenge";
import { TwoFactorVerificationDescriptor } from "../entities/two-factor-verification";
import { PendingAuthGuard, PendingAuthPayload } from "../guards/pending-auth.guard";
import { BackupCodeService } from "../services/backup-code.service";
import { PasskeyService } from "../services/passkey.service";
import { TwoFactorService } from "../services/two-factor.service";

/**
 * Request with pending auth payload attached.
 */
interface PendingAuthRequest {
  pendingAuth: PendingAuthPayload;
}

/**
 * Two-Factor Authentication Controller
 *
 * Handles 2FA status management and verification during login.
 *
 * Status/Enable/Disable endpoints require full JWT authentication.
 * Verification endpoints require pending 2FA token (issued after password validation).
 */
@Controller("auth")
export class TwoFactorController {
  constructor(
    private readonly jsonApiService: JsonApiService,
    private readonly twoFactorService: TwoFactorService,
    private readonly passkeyService: PasskeyService,
    private readonly backupCodeService: BackupCodeService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  /**
   * GET /auth/two-factor/status
   *
   * Get the 2FA status for the authenticated user.
   * Returns enabled state, preferred method, available methods, and backup codes count.
   */
  @UseGuards(JwtAuthGuard)
  @Get("two-factor/status")
  async getStatus(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const userId = req.user.userId;
    const response = await this.twoFactorService.getStatus(userId);
    reply.send(response);
  }

  /**
   * POST /auth/two-factor/enable
   *
   * Enable 2FA for the authenticated user.
   * Requires at least one 2FA method (TOTP or passkey) to be configured.
   */
  @UseGuards(JwtAuthGuard)
  @Post("two-factor/enable")
  async enable(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: TwoFactorEnableDTO) {
    const userId = req.user.userId;
    const response = await this.twoFactorService.enable(userId, body.data.attributes.preferredMethod);
    reply.send(response);
  }

  /**
   * POST /auth/two-factor/disable
   *
   * Disable 2FA for the authenticated user.
   */
  @UseGuards(JwtAuthGuard)
  @Post("two-factor/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const userId = req.user.userId;
    await this.twoFactorService.disable(userId);
    reply.send();
  }

  /**
   * POST /auth/two-factor/challenge
   *
   * Request a 2FA challenge for the specified method.
   * For passkeys, returns WebAuthn authentication options.
   * For TOTP and backup codes, returns a simple acknowledgment (no challenge needed).
   *
   * Requires pending 2FA token from login.
   */
  @UseGuards(PendingAuthGuard)
  @Post("two-factor/challenge")
  async challenge(@Req() req: PendingAuthRequest, @Res() reply: FastifyReply, @Body() body: TwoFactorChallengeDTO) {
    const { userId, pendingId } = req.pendingAuth;
    const method = body.data.attributes.method;

    if (method === "passkey") {
      // Generate WebAuthn authentication options - service returns JSON:API
      const optionsResponse = await this.passkeyService.generateAuthenticationOptions({ userId });
      // Build challenge response with passkey options
      const response = this.jsonApiService.buildSingle(TwoFactorChallengeDescriptor.model, {
        id: pendingId,
        method: "passkey",
        pendingId: optionsResponse.data.attributes.pendingId,
        options: optionsResponse.data.attributes.options,
      });
      reply.send(response);
      return;
    }

    // For TOTP and backup codes, no challenge is needed - just return available methods
    const methods = await this.twoFactorService.getAvailableMethods(userId);
    const response = this.jsonApiService.buildSingle(TwoFactorChallengeDescriptor.model, {
      id: pendingId,
      method,
      pendingId,
      availableMethods: methods,
    });
    reply.send(response);
  }

  /**
   * POST /auth/two-factor/verify/totp
   *
   * Verify a TOTP code to complete 2FA login.
   * On success, the full JWT tokens are issued by the auth service.
   *
   * Requires pending 2FA token from login.
   */
  @UseGuards(PendingAuthGuard)
  @Post("two-factor/verify/totp")
  async verifyTotp(@Req() req: PendingAuthRequest, @Res() reply: FastifyReply, @Body() body: TotpVerifyDTO) {
    const { pendingId, userId } = req.pendingAuth;
    const verificationResult = await this.twoFactorService.verifyTotp(pendingId, body.data.attributes.code);

    // Check if verification was successful
    if (verificationResult.data?.attributes?.success) {
      // Return full auth tokens
      const authResponse = await this.authService.completeTwoFactorLogin(userId);
      reply.send(authResponse);
      return;
    }

    // Verification failed - return the error response
    reply.send(verificationResult);
  }

  /**
   * POST /auth/two-factor/verify/passkey/options
   *
   * Get passkey authentication options for 2FA verification.
   * Returns WebAuthn options to be passed to navigator.credentials.get().
   *
   * Requires pending 2FA token from login.
   */
  @UseGuards(PendingAuthGuard)
  @Post("two-factor/verify/passkey/options")
  async getPasskeyOptions(@Req() req: PendingAuthRequest, @Res() reply: FastifyReply) {
    const { userId } = req.pendingAuth;
    const response = await this.passkeyService.generateAuthenticationOptions({ userId });
    reply.send(response);
  }

  /**
   * POST /auth/two-factor/verify/passkey
   *
   * Verify a passkey to complete 2FA login.
   * On success, the full JWT tokens are issued by the auth service.
   *
   * Requires pending 2FA token from login.
   */
  @UseGuards(PendingAuthGuard)
  @Post("two-factor/verify/passkey")
  async verifyPasskey(
    @Req() req: PendingAuthRequest,
    @Res() reply: FastifyReply,
    @Body() body: PasskeyAuthenticationVerifyDTO,
  ) {
    const { pendingId } = body.data.attributes;
    const passkeyId = await this.passkeyService.verifyAuthentication({
      pendingId,
      response: body.data.attributes.response as any,
    });

    // Delete the login pending session
    await this.twoFactorService.deletePendingSession(req.pendingAuth.pendingId);

    if (passkeyId) {
      // Verification successful - return full auth tokens
      const authResponse = await this.authService.completeTwoFactorLogin(req.pendingAuth.userId);
      reply.send(authResponse);
      return;
    }

    // Verification failed
    const response = this.jsonApiService.buildSingle(TwoFactorVerificationDescriptor.model, {
      id: req.pendingAuth.pendingId,
      success: false,
    });
    reply.send(response);
  }

  /**
   * POST /auth/two-factor/verify/backup
   *
   * Verify a backup code to complete 2FA login.
   * Backup codes are single-use and will be marked as used after successful verification.
   *
   * Requires pending 2FA token from login.
   */
  @UseGuards(PendingAuthGuard)
  @Post("two-factor/verify/backup")
  async verifyBackupCode(
    @Req() req: PendingAuthRequest,
    @Res() reply: FastifyReply,
    @Body() body: BackupCodeVerifyDTO,
  ) {
    const { pendingId, userId } = req.pendingAuth;
    const verificationResult = await this.twoFactorService.verifyBackupCode(pendingId, body.data.attributes.code);

    // Check if verification was successful
    if (verificationResult.data?.attributes?.success) {
      // Return full auth tokens
      const authResponse = await this.authService.completeTwoFactorLogin(userId);
      reply.send(authResponse);
      return;
    }

    // Verification failed - return the error response
    reply.send(verificationResult);
  }

  /**
   * POST /auth/backup-codes/generate
   *
   * Generate new backup codes for the authenticated user.
   * If the user already has backup codes, use regenerate endpoint instead.
   * Returns the plain text codes ONCE - they should be shown to the user.
   */
  @UseGuards(JwtAuthGuard)
  @Post("backup-codes/generate")
  async generateBackupCodes(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const userId = req.user.userId;
    const response = await this.backupCodeService.generateCodes({ userId });

    // Update backup codes count in 2FA config
    await this.twoFactorService.updateBackupCodesCount(userId);

    reply.send(response);
  }

  /**
   * POST /auth/backup-codes/regenerate
   *
   * Regenerate backup codes for the authenticated user.
   * This deletes all existing codes (used and unused) and generates a new batch.
   * Returns the new plain text codes ONCE - they should be shown to the user.
   */
  @UseGuards(JwtAuthGuard)
  @Post("backup-codes/regenerate")
  async regenerateBackupCodes(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const userId = req.user.userId;
    const response = await this.backupCodeService.regenerateCodes({ userId });

    // Update backup codes count in 2FA config
    await this.twoFactorService.updateBackupCodesCount(userId);

    reply.send(response);
  }

  /**
   * GET /auth/backup-codes/count
   *
   * Get the count of unused backup codes for the authenticated user.
   */
  @UseGuards(JwtAuthGuard)
  @Get("backup-codes/count")
  async getBackupCodesCount(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const userId = req.user.userId;
    const response = await this.backupCodeService.getUnusedCount({ userId });
    reply.send(response);
  }
}
