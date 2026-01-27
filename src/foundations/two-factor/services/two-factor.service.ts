import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import * as crypto from "crypto";
import { baseConfig } from "../../../config/base.config";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { PendingTwoFactor } from "../entities/pending-two-factor";
import { TwoFactorConfig, TwoFactorConfigDescriptor } from "../entities/two-factor-config";
import { TwoFactorStatusDescriptor } from "../entities/two-factor-status";
import { TwoFactorVerificationDescriptor } from "../entities/two-factor-verification";
import { PendingTwoFactorRepository } from "../repositories/pending-two-factor.repository";
import { TwoFactorConfigRepository } from "../repositories/two-factor-config.repository";
import { BackupCodeService } from "./backup-code.service";
import { PasskeyService } from "./passkey.service";
import { TotpService } from "./totp.service";

export type TwoFactorMethod = "totp" | "passkey" | "backup";

export interface TwoFactorStatus {
  isEnabled: boolean;
  preferredMethod: TwoFactorMethod;
  methods: {
    totp: boolean;
    passkey: boolean;
    backup: boolean;
  };
  backupCodesCount: number;
}

export interface PendingSession {
  pendingId: string;
  expiration: Date;
}

export interface VerificationResult {
  success: boolean;
  userId?: string;
}

/**
 * Two-Factor Orchestration Service
 *
 * Coordinates all 2FA functionality including status management, method verification,
 * and pending session handling. This service is the main entry point for 2FA operations
 * and delegates to specialized services (TOTP, Passkey, BackupCode) for specific tasks.
 */
@Injectable()
export class TwoFactorService {
  private readonly pendingTtlSeconds: number;
  private readonly maxTotpAttempts = 5;
  private readonly maxPasskeyAttempts = 3;
  private readonly maxBackupAttempts = 3;

  constructor(
    private readonly jsonApiService: JsonApiService,
    private readonly twoFactorConfigRepository: TwoFactorConfigRepository,
    private readonly pendingTwoFactorRepository: PendingTwoFactorRepository,
    private readonly totpService: TotpService,
    private readonly passkeyService: PasskeyService,
    private readonly backupCodeService: BackupCodeService,
  ) {
    this.pendingTtlSeconds = baseConfig.twoFactor?.pendingTtl ?? 300; // 5 minutes default
  }

  /**
   * Get the 2FA configuration for a user.
   *
   * @param userId - The user's ID
   * @returns The user's TwoFactorConfig, or null if not configured
   */
  async getConfig(userId: string): Promise<TwoFactorConfig | null> {
    const config = await this.twoFactorConfigRepository.findByUserId({ userId });
    return config;
  }

  /**
   * Get the full 2FA status for a user including available methods.
   *
   * @param userId - The user's ID
   * @returns JSON:API response with 2FA status
   */
  async getStatus(userId: string): Promise<any> {
    const config = await this.twoFactorConfigRepository.findByUserId({ userId });

    // Check method availability in parallel
    const [hasTotp, hasPasskey, backupCodesCount] = await Promise.all([
      this.totpService.hasVerifiedAuthenticator({ userId }),
      this.passkeyService.hasPasskeys({ userId }),
      this.backupCodeService.getRawUnusedCount({ userId }),
    ]);

    const hasBackup = backupCodesCount > 0;

    return this.jsonApiService.buildSingle(TwoFactorStatusDescriptor.model, {
      id: userId,
      isEnabled: config?.isEnabled ?? false,
      preferredMethod: (config?.preferredMethod as TwoFactorMethod) ?? "totp",
      methods: {
        totp: hasTotp,
        passkey: hasPasskey,
        backup: hasBackup,
      },
      backupCodesCount,
    });
  }

  /**
   * Enable 2FA for a user.
   * Requires at least one 2FA method to be configured.
   *
   * @param userId - The user's ID
   * @param preferredMethod - The preferred 2FA method (default: 'totp')
   * @throws BadRequestException if no 2FA methods are configured
   * @returns JSON:API response with the 2FA config
   */
  async enable(userId: string, preferredMethod: TwoFactorMethod = "totp"): Promise<any> {
    // Check that at least one method is available
    const [hasTotp, hasPasskey] = await Promise.all([
      this.totpService.hasVerifiedAuthenticator({ userId }),
      this.passkeyService.hasPasskeys({ userId }),
    ]);

    if (!hasTotp && !hasPasskey) {
      throw new BadRequestException("Cannot enable 2FA without at least one configured method (TOTP or Passkey)");
    }

    // Validate preferred method is available
    if (preferredMethod === "totp" && !hasTotp) {
      preferredMethod = "passkey";
    } else if (preferredMethod === "passkey" && !hasPasskey) {
      preferredMethod = "totp";
    }

    // Get or create config
    const existingConfig = await this.twoFactorConfigRepository.findByUserId({ userId });

    let config: TwoFactorConfig;
    if (existingConfig) {
      config = await this.twoFactorConfigRepository.updateByUserId({
        userId,
        isEnabled: true,
        preferredMethod,
      });
    } else {
      config = await this.twoFactorConfigRepository.createForUser({
        configId: crypto.randomUUID(),
        userId,
        isEnabled: true,
        preferredMethod,
      });
    }

    return this.jsonApiService.buildSingle(TwoFactorConfigDescriptor.model, config);
  }

  /**
   * Disable 2FA for a user.
   *
   * @param userId - The user's ID
   */
  async disable(userId: string): Promise<TwoFactorConfig | null> {
    const config = await this.twoFactorConfigRepository.findByUserId({ userId });

    if (!config) {
      return null;
    }

    return this.twoFactorConfigRepository.updateByUserId({
      userId,
      isEnabled: false,
    });
  }

  /**
   * Set the preferred 2FA method for a user.
   *
   * @param userId - The user's ID
   * @param method - The preferred method
   * @throws BadRequestException if the method is not available
   */
  async setPreferredMethod(userId: string, method: TwoFactorMethod): Promise<TwoFactorConfig> {
    // Validate the method is available
    let isAvailable = false;

    switch (method) {
      case "totp":
        isAvailable = await this.totpService.hasVerifiedAuthenticator({ userId });
        break;
      case "passkey":
        isAvailable = await this.passkeyService.hasPasskeys({ userId });
        break;
      case "backup":
        throw new BadRequestException("Backup codes cannot be set as preferred method");
    }

    if (!isAvailable) {
      throw new BadRequestException(`Cannot set ${method} as preferred - method not configured`);
    }

    const config = await this.twoFactorConfigRepository.findByUserId({ userId });

    if (!config) {
      throw new NotFoundException("Two-factor configuration not found");
    }

    return this.twoFactorConfigRepository.updateByUserId({
      userId,
      preferredMethod: method,
    });
  }

  /**
   * Create a pending 2FA session after successful password validation.
   * This is called by the auth service when a user with 2FA enabled logs in.
   *
   * @param userId - The user's ID
   * @returns The pending session info
   */
  async createPendingSession(userId: string): Promise<PendingSession> {
    const pendingId = crypto.randomUUID();
    const expiration = new Date(Date.now() + this.pendingTtlSeconds * 1000);

    // Create the pending session with a simple challenge
    // The challenge is just a random string for session identification
    const challenge = crypto.randomBytes(32).toString("base64url");

    await this.pendingTwoFactorRepository.createForUser({
      pendingId,
      userId,
      challenge,
      challengeType: "login",
      expiration,
    });

    return {
      pendingId,
      expiration,
    };
  }

  /**
   * Get available 2FA methods for a user during login.
   *
   * @param userId - The user's ID
   * @returns Array of available method names
   */
  async getAvailableMethods(userId: string): Promise<TwoFactorMethod[]> {
    const [hasTotp, hasPasskey, backupCodesCount] = await Promise.all([
      this.totpService.hasVerifiedAuthenticator({ userId }),
      this.passkeyService.hasPasskeys({ userId }),
      this.backupCodeService.getRawUnusedCount({ userId }),
    ]);

    const methods: TwoFactorMethod[] = [];

    if (hasTotp) methods.push("totp");
    if (hasPasskey) methods.push("passkey");
    if (backupCodesCount > 0) methods.push("backup");

    return methods;
  }

  /**
   * Verify a TOTP code for 2FA login.
   *
   * @param pendingId - The pending session ID from createPendingSession
   * @param code - The 6-digit TOTP code
   * @returns JSON:API response with verification result
   */
  async verifyTotp(pendingId: string, code: string): Promise<any> {
    const pendingData = await this.validateAndGetPending(pendingId, "login");

    // Check attempt count
    const attemptCount = await this.pendingTwoFactorRepository.incrementAttemptCount({ pendingId });
    if (attemptCount > this.maxTotpAttempts) {
      await this.pendingTwoFactorRepository.deletePending({ pendingId });
      throw new BadRequestException("Maximum TOTP attempts exceeded");
    }

    // Verify the code
    const authenticatorId = await this.totpService.verifyCodeForUser({
      userId: pendingData.userId,
      code,
    });

    if (!authenticatorId) {
      return this.jsonApiService.buildSingle(TwoFactorVerificationDescriptor.model, {
        id: pendingId,
        success: false,
      });
    }

    // Clean up the pending session
    await this.pendingTwoFactorRepository.deletePending({ pendingId });

    return this.jsonApiService.buildSingle(TwoFactorVerificationDescriptor.model, {
      id: pendingId,
      success: true,
      userId: pendingData.userId,
    });
  }

  /**
   * Verify a passkey for 2FA login.
   *
   * @param pendingId - The pending session ID
   * @param response - The WebAuthn authentication response
   * @returns JSON:API response with verification result
   */
  async verifyPasskey(
    pendingId: string,
    response: Parameters<typeof PasskeyService.prototype.verifyAuthentication>[0]["response"],
  ): Promise<any> {
    const pendingData = await this.validateAndGetPending(pendingId, "login");

    // Check attempt count
    const attemptCount = await this.pendingTwoFactorRepository.incrementAttemptCount({ pendingId });
    if (attemptCount > this.maxPasskeyAttempts) {
      await this.pendingTwoFactorRepository.deletePending({ pendingId });
      throw new BadRequestException("Maximum passkey attempts exceeded");
    }

    // For passkey verification during login, we need to use the existing passkey challenge
    // But since this is a 2FA flow after password, we're verifying differently
    // We need to generate auth options first if not already done
    try {
      // First, generate authentication options
      const authOptions = await this.passkeyService.generateAuthenticationOptions({
        userId: pendingData.userId,
      });

      // Note: In a real implementation, the client would need to perform the WebAuthn
      // ceremony with these options. For the 2FA flow, we're doing a simplified verification.
      // The actual passkey verification happens via the passkey.service.verifyAuthentication
      const passkeyId = await this.passkeyService.verifyAuthentication({
        pendingId: authOptions.data.attributes.pendingId,
        response,
      });

      if (!passkeyId) {
        return this.jsonApiService.buildSingle(TwoFactorVerificationDescriptor.model, {
          id: pendingId,
          success: false,
        });
      }

      // Clean up the login pending session
      await this.pendingTwoFactorRepository.deletePending({ pendingId });

      return this.jsonApiService.buildSingle(TwoFactorVerificationDescriptor.model, {
        id: pendingId,
        success: true,
        userId: pendingData.userId,
      });
    } catch {
      return this.jsonApiService.buildSingle(TwoFactorVerificationDescriptor.model, {
        id: pendingId,
        success: false,
      });
    }
  }

  /**
   * Verify a backup code for 2FA login.
   *
   * @param pendingId - The pending session ID
   * @param code - The backup code
   * @returns JSON:API response with verification result
   */
  async verifyBackupCode(pendingId: string, code: string): Promise<any> {
    const pendingData = await this.validateAndGetPending(pendingId, "login");

    // Check attempt count
    const attemptCount = await this.pendingTwoFactorRepository.incrementAttemptCount({ pendingId });
    if (attemptCount > this.maxBackupAttempts) {
      await this.pendingTwoFactorRepository.deletePending({ pendingId });
      throw new BadRequestException("Maximum backup code attempts exceeded");
    }

    // Verify the backup code
    const isValid = await this.backupCodeService.validateCode({
      userId: pendingData.userId,
      code,
    });

    if (!isValid) {
      return this.jsonApiService.buildSingle(TwoFactorVerificationDescriptor.model, {
        id: pendingId,
        success: false,
      });
    }

    // Update backup codes count in config
    const unusedCount = await this.backupCodeService.getRawUnusedCount({ userId: pendingData.userId });
    await this.twoFactorConfigRepository.updateByUserId({
      userId: pendingData.userId,
      backupCodesCount: unusedCount,
    });

    // Clean up the pending session
    await this.pendingTwoFactorRepository.deletePending({ pendingId });

    return this.jsonApiService.buildSingle(TwoFactorVerificationDescriptor.model, {
      id: pendingId,
      success: true,
      userId: pendingData.userId,
    });
  }

  /**
   * Get pending session info by ID.
   *
   * @param pendingId - The pending session ID
   * @returns The pending session data if found
   */
  async getPendingSession(pendingId: string): Promise<{ pending: PendingTwoFactor; userId: string } | null> {
    return this.pendingTwoFactorRepository.findByIdWithUser({ pendingId });
  }

  /**
   * Delete a pending session.
   *
   * @param pendingId - The pending session ID
   */
  async deletePendingSession(pendingId: string): Promise<void> {
    await this.pendingTwoFactorRepository.deletePending({ pendingId });
  }

  /**
   * Update backup codes count in the config.
   * Called after generating or using backup codes.
   *
   * @param userId - The user's ID
   */
  async updateBackupCodesCount(userId: string): Promise<void> {
    const unusedCount = await this.backupCodeService.getRawUnusedCount({ userId });
    const config = await this.twoFactorConfigRepository.findByUserId({ userId });

    if (config) {
      await this.twoFactorConfigRepository.updateByUserId({
        userId,
        backupCodesCount: unusedCount,
      });
    }
  }

  /**
   * Check if 2FA should be automatically disabled due to no methods remaining.
   * Called when removing the last TOTP authenticator or passkey.
   *
   * @param userId - The user's ID
   * @returns true if 2FA was disabled
   */
  async checkAndDisableIfNoMethods(userId: string): Promise<boolean> {
    const [hasTotp, hasPasskey] = await Promise.all([
      this.totpService.hasVerifiedAuthenticator({ userId }),
      this.passkeyService.hasPasskeys({ userId }),
    ]);

    if (!hasTotp && !hasPasskey) {
      const config = await this.twoFactorConfigRepository.findByUserId({ userId });
      if (config?.isEnabled) {
        await this.disable(userId);
        return true;
      }
    }

    return false;
  }

  /**
   * Validate a pending session and return its data.
   *
   * @param pendingId - The pending session ID
   * @param expectedType - The expected challenge type
   * @throws NotFoundException if session not found
   * @throws BadRequestException if session expired or wrong type
   */
  private async validateAndGetPending(
    pendingId: string,
    expectedType: string,
  ): Promise<{ pending: PendingTwoFactor; userId: string }> {
    const pendingData = await this.pendingTwoFactorRepository.findByIdWithUser({ pendingId });

    if (!pendingData) {
      throw new NotFoundException("Pending 2FA session not found");
    }

    const { pending } = pendingData;

    // Check challenge type
    if (pending.challengeType !== expectedType) {
      throw new BadRequestException(`Invalid challenge type: expected ${expectedType}`);
    }

    // Check expiration
    if (new Date() > pending.expiration) {
      await this.pendingTwoFactorRepository.deletePending({ pendingId });
      throw new BadRequestException("2FA session has expired");
    }

    return pendingData;
  }
}
