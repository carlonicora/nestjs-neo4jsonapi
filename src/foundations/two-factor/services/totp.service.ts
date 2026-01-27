import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import * as crypto from "crypto";
import * as OTPAuth from "otpauth";
import * as QRCode from "qrcode";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { TotpAuthenticatorDescriptor } from "../entities/totp-authenticator";
import { TotpSetupDescriptor } from "../entities/totp-setup";
import { TotpAuthenticatorRepository } from "../repositories/totp-authenticator.repository";
import { TotpEncryptionService } from "./totp-encryption.service";

export interface TotpSetupResponse {
  authenticatorId: string;
  secret: string;
  qrCodeUri: string;
  qrCodeDataUrl: string;
}

export interface TotpAuthenticatorInfo {
  id: string;
  name: string;
  verified: boolean;
  lastUsedAt?: Date;
  createdAt: Date;
}

/**
 * TOTP Service
 *
 * Manages TOTP (Time-based One-Time Password) authenticators for two-factor authentication.
 * Provides secret generation, QR code creation, code verification, and authenticator management.
 */
@Injectable()
export class TotpService {
  private readonly logger: Logger = new Logger(TotpService.name);
  private readonly issuer = "Only35";
  private readonly algorithm = "SHA1";
  private readonly digits = 6;
  private readonly period = 30; // seconds

  constructor(
    private readonly jsonApiService: JsonApiService,
    private readonly totpAuthenticatorRepository: TotpAuthenticatorRepository,
    private readonly totpEncryptionService: TotpEncryptionService,
  ) {}

  /**
   * Generate a new TOTP secret and return setup information.
   *
   * @param params.userId - The user's ID
   * @param params.name - A friendly name for this authenticator (e.g., "Google Authenticator")
   * @param params.accountName - The account name to display in authenticator apps (typically email)
   * @returns JSON:API response with setup info (QR code, secret)
   */
  async generateSecret(params: { userId: string; name: string; accountName: string }): Promise<any> {
    // Generate a new TOTP secret
    const secret = new OTPAuth.Secret({ size: 20 });

    // Create TOTP instance for URI generation
    const totp = new OTPAuth.TOTP({
      issuer: this.issuer,
      label: params.accountName,
      algorithm: this.algorithm,
      digits: this.digits,
      period: this.period,
      secret: secret,
    });

    // Get the otpauth:// URI for QR code
    const qrCodeUri = totp.toString();

    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUri);

    // Encrypt the secret before storing
    const encryptedSecret = this.totpEncryptionService.encrypt(secret.base32);

    // Create the authenticator in pending (unverified) state
    const authenticatorId = crypto.randomUUID();
    await this.totpAuthenticatorRepository.createForUser({
      authenticatorId,
      userId: params.userId,
      name: params.name,
      secret: encryptedSecret,
      verified: false,
    });

    return this.jsonApiService.buildSingle(TotpSetupDescriptor.model, {
      id: authenticatorId,
      secret: secret.base32,
      qrCodeUri,
      qrCodeDataUrl,
    });
  }

  /**
   * Generate QR code URI for an existing authenticator.
   * Only works for unverified authenticators.
   *
   * @param params.authenticatorId - The authenticator ID
   * @param params.accountName - The account name for the QR code
   * @returns QR code URI and data URL
   */
  async generateQRCodeUri(params: {
    authenticatorId: string;
    accountName: string;
  }): Promise<{ qrCodeUri: string; qrCodeDataUrl: string }> {
    const authenticator = await this.totpAuthenticatorRepository.findByIdWithSecret({
      authenticatorId: params.authenticatorId,
    });

    if (!authenticator) {
      throw new NotFoundException("Authenticator not found");
    }

    if (authenticator.verified) {
      throw new BadRequestException("Cannot regenerate QR code for verified authenticator");
    }

    // Decrypt the secret
    const decryptedSecret = this.totpEncryptionService.decrypt(authenticator.secret);

    // Create TOTP instance for URI generation
    const totp = new OTPAuth.TOTP({
      issuer: this.issuer,
      label: params.accountName,
      algorithm: this.algorithm,
      digits: this.digits,
      period: this.period,
      secret: OTPAuth.Secret.fromBase32(decryptedSecret),
    });

    const qrCodeUri = totp.toString();
    const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUri);

    return { qrCodeUri, qrCodeDataUrl };
  }

  /**
   * Verify a TOTP code against an authenticator.
   *
   * @param params.authenticatorId - The authenticator ID
   * @param params.code - The 6-digit TOTP code
   * @returns true if the code is valid
   */
  async verifyCode(params: { authenticatorId: string; code: string }): Promise<boolean> {
    const authenticator = await this.totpAuthenticatorRepository.findByIdWithSecret({
      authenticatorId: params.authenticatorId,
    });

    if (!authenticator) {
      throw new NotFoundException("Authenticator not found");
    }

    // Decrypt the secret
    const decryptedSecret = this.totpEncryptionService.decrypt(authenticator.secret);

    // Create TOTP instance
    const totp = new OTPAuth.TOTP({
      issuer: this.issuer,
      algorithm: this.algorithm,
      digits: this.digits,
      period: this.period,
      secret: OTPAuth.Secret.fromBase32(decryptedSecret),
    });

    // Validate with 1 period window (allows for time drift)
    const delta = totp.validate({ token: params.code, window: 1 });

    if (delta !== null) {
      // Update last used time
      await this.totpAuthenticatorRepository.updateAuthenticator({
        authenticatorId: params.authenticatorId,
        lastUsedAt: new Date(),
      });
      return true;
    }

    return false;
  }

  /**
   * Verify a TOTP code for any verified authenticator belonging to a user.
   *
   * @param params.userId - The user's ID
   * @param params.code - The 6-digit TOTP code
   * @returns The authenticator ID if verification succeeds, null otherwise
   */
  async verifyCodeForUser(params: { userId: string; code: string }): Promise<string | null> {
    const authenticators = await this.totpAuthenticatorRepository.findAllByUserIdWithSecrets({
      userId: params.userId,
    });

    for (const authenticator of authenticators) {
      // Skip unverified authenticators
      if (!authenticator.verified) {
        continue;
      }

      // Decrypt the secret
      const decryptedSecret = this.totpEncryptionService.decrypt(authenticator.secret);

      // Create TOTP instance
      const totp = new OTPAuth.TOTP({
        issuer: this.issuer,
        algorithm: this.algorithm,
        digits: this.digits,
        period: this.period,
        secret: OTPAuth.Secret.fromBase32(decryptedSecret),
      });

      // Validate with 1 period window
      const delta = totp.validate({ token: params.code, window: 1 });

      if (delta !== null) {
        // Update last used time
        await this.totpAuthenticatorRepository.updateAuthenticator({
          authenticatorId: authenticator.id,
          lastUsedAt: new Date(),
        });
        return authenticator.id;
      }
    }

    return null;
  }

  /**
   * Add (verify) an authenticator by validating a TOTP code.
   * This marks the authenticator as verified and ready for use.
   *
   * @param params.authenticatorId - The authenticator ID from generateSecret
   * @param params.code - The 6-digit TOTP code from the authenticator app
   * @returns JSON:API response with verified authenticator, or null if verification failed
   */
  async addAuthenticator(params: { authenticatorId: string; code: string }): Promise<any> {
    const authenticator = await this.totpAuthenticatorRepository.findByIdWithSecret({
      authenticatorId: params.authenticatorId,
    });

    if (!authenticator) {
      throw new NotFoundException("Authenticator not found");
    }

    if (authenticator.verified) {
      throw new BadRequestException("Authenticator is already verified");
    }

    // Verify the code
    const isValid = await this.verifyCode({
      authenticatorId: params.authenticatorId,
      code: params.code,
    });

    if (!isValid) {
      return null;
    }

    // Mark as verified and get updated authenticator
    const verifiedAuthenticator = await this.totpAuthenticatorRepository.updateAuthenticator({
      authenticatorId: params.authenticatorId,
      verified: true,
    });

    return this.jsonApiService.buildSingle(TotpAuthenticatorDescriptor.model, verifiedAuthenticator);
  }

  /**
   * Remove an authenticator.
   *
   * @param params.authenticatorId - The authenticator ID to remove
   */
  async removeAuthenticator(params: { authenticatorId: string }): Promise<void> {
    const authenticator = await this.totpAuthenticatorRepository.findByIdForUser({
      authenticatorId: params.authenticatorId,
    });

    if (!authenticator) {
      throw new NotFoundException("Authenticator not found");
    }

    await this.totpAuthenticatorRepository.deleteAuthenticator({
      authenticatorId: params.authenticatorId,
    });
  }

  /**
   * List all authenticators for a user.
   *
   * @param params.userId - The user's ID
   * @param params.verifiedOnly - If true, only return verified authenticators
   * @returns JSON:API response with list of authenticators
   */
  async listAuthenticators(params: { userId: string; verifiedOnly?: boolean }): Promise<any> {
    const authenticators = params.verifiedOnly
      ? await this.totpAuthenticatorRepository.findVerifiedByUserId({ userId: params.userId })
      : await this.totpAuthenticatorRepository.findAllByUserIdWithSecrets({ userId: params.userId });

    return this.jsonApiService.buildList(TotpAuthenticatorDescriptor.model, authenticators);
  }

  /**
   * Check if a user has any verified TOTP authenticators.
   *
   * @param params.userId - The user's ID
   * @returns true if the user has at least one verified authenticator
   */
  async hasVerifiedAuthenticator(params: { userId: string }): Promise<boolean> {
    const count = await this.totpAuthenticatorRepository.countVerifiedByUserId({
      userId: params.userId,
    });
    return count > 0;
  }

  /**
   * Delete an unverified authenticator (cleanup for abandoned setup).
   *
   * @param params.authenticatorId - The authenticator ID
   */
  async deleteUnverifiedAuthenticator(params: { authenticatorId: string }): Promise<void> {
    const authenticator = await this.totpAuthenticatorRepository.findByIdForUser({
      authenticatorId: params.authenticatorId,
    });

    if (!authenticator) {
      throw new NotFoundException("Authenticator not found");
    }

    if (authenticator.verified) {
      throw new BadRequestException("Cannot delete a verified authenticator using this method");
    }

    await this.totpAuthenticatorRepository.deleteAuthenticator({
      authenticatorId: params.authenticatorId,
    });
  }
}
