import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialDescriptorJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import * as crypto from "crypto";
import { baseConfig } from "../../../config/base.config";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { PasskeyDescriptor } from "../entities/passkey";
import { PasskeyAuthenticationOptionsDescriptor } from "../entities/passkey-authentication-options";
import { PasskeyRegistrationOptionsDescriptor } from "../entities/passkey-registration-options";
import { PasskeyRepository } from "../repositories/passkey.repository";
import { PendingTwoFactorRepository } from "../repositories/pending-two-factor.repository";
import {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../core/jsonapi/interfaces/jsonapi.document.interface";

export interface PasskeyRegistrationOptions {
  pendingId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface PasskeyAuthenticationOptions {
  pendingId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  backedUp: boolean;
  lastUsedAt?: Date;
  createdAt: Date;
}

/**
 * Passkey Service
 *
 * Manages WebAuthn passkey registration and authentication for two-factor authentication.
 * Provides passkey enrollment, verification, and management capabilities.
 */
@Injectable()
export class PasskeyService {
  private readonly challengeTtlSeconds = 300; // 5 minutes

  constructor(
    private readonly jsonApiService: JsonApiService,
    private readonly passkeyRepository: PasskeyRepository,
    private readonly pendingTwoFactorRepository: PendingTwoFactorRepository,
  ) {}

  /**
   * Get WebAuthn Relying Party configuration from environment.
   */
  private getRpConfig() {
    return {
      rpId: baseConfig.twoFactor.webauthnRpId,
      rpName: baseConfig.twoFactor.webauthnRpName,
      origin: baseConfig.twoFactor.webauthnOrigin,
    };
  }

  /**
   * Generate registration options for creating a new passkey.
   *
   * @param params.userId - The user's ID
   * @param params.userName - The user's email or username
   * @param params.userDisplayName - The user's display name
   * @returns JSON:API response with registration options
   */
  async generateRegistrationOptions(params: {
    userId: string;
    userName: string;
    userDisplayName: string;
  }): Promise<JsonApiSingleDocument> {
    const { rpId, rpName } = this.getRpConfig();

    // Get existing passkeys to exclude them from registration
    const existingPasskeys = await this.passkeyRepository.findAllByUserIdWithCredentials({
      userId: params.userId,
    });

    const excludeCredentials: PublicKeyCredentialDescriptorJSON[] = existingPasskeys.map((passkey) => ({
      id: passkey.credentialId,
      type: "public-key" as const,
      transports: this.parseTransports(passkey.transports),
    }));

    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      userName: params.userName,
      userDisplayName: params.userDisplayName,
      // Use base64url-encoded user ID for WebAuthn
      userID: new TextEncoder().encode(params.userId),
      attestationType: "none", // We don't need attestation for 2FA
      excludeCredentials,
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
        // Allow both platform (Touch ID, Windows Hello) and cross-platform (USB keys)
        authenticatorAttachment: undefined,
      },
      timeout: 60000, // 60 seconds
    });

    // Store the challenge for verification
    const pendingId = crypto.randomUUID();
    const expiration = new Date(Date.now() + this.challengeTtlSeconds * 1000);

    await this.pendingTwoFactorRepository.createForUser({
      pendingId,
      userId: params.userId,
      challenge: options.challenge,
      challengeType: "passkey-registration",
      expiration,
    });

    return this.jsonApiService.buildSingle(PasskeyRegistrationOptionsDescriptor.model, {
      id: pendingId,
      pendingId,
      options,
    });
  }

  /**
   * Verify a passkey registration response and create the passkey.
   *
   * @param params.pendingId - The pending challenge ID from generateRegistrationOptions
   * @param params.name - A friendly name for this passkey
   * @param params.response - The WebAuthn credential response from the client
   * @returns JSON:API response with the created passkey
   */
  async verifyRegistration(params: {
    pendingId: string;
    name: string;
    response: RegistrationResponseJSON;
  }): Promise<JsonApiSingleDocument> {
    const { rpId, origin } = this.getRpConfig();

    // Get the pending challenge
    const pendingData = await this.pendingTwoFactorRepository.findByIdWithUser({
      pendingId: params.pendingId,
    });

    if (!pendingData) {
      throw new NotFoundException("Registration challenge not found or expired");
    }

    const { pending, userId } = pendingData;

    // Validate challenge type
    if (pending.challengeType !== "passkey-registration") {
      throw new BadRequestException("Invalid challenge type");
    }

    // Check expiration
    if (new Date() > pending.expiration) {
      await this.pendingTwoFactorRepository.deletePending({ pendingId: params.pendingId });
      throw new BadRequestException("Registration challenge has expired");
    }

    // Verify the registration response
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: params.response,
        expectedChallenge: pending.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: false, // Allow UV to be optional for broader device support
      });
    } catch (error) {
      throw new BadRequestException(`Registration verification failed: ${(error as Error).message}`);
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException("Registration verification failed");
    }

    const { credential, credentialBackedUp } = verification.registrationInfo;

    // Create the passkey in the database
    const passkeyId = crypto.randomUUID();

    const passkey = await this.passkeyRepository.createForUser({
      passkeyId,
      userId,
      name: params.name,
      credentialId: this.uint8ArrayToBase64Url(credential.id),
      publicKey: this.uint8ArrayToBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: params.response.response.transports || [],
      backedUp: credentialBackedUp,
    });

    // Delete the pending challenge
    await this.pendingTwoFactorRepository.deletePending({ pendingId: params.pendingId });

    return this.jsonApiService.buildSingle(PasskeyDescriptor.model, passkey);
  }

  /**
   * Generate authentication options for passkey sign-in.
   *
   * @param params.userId - The user's ID
   * @returns JSON:API response with authentication options
   */
  async generateAuthenticationOptions(params: { userId: string }): Promise<JsonApiSingleDocument> {
    const { rpId } = this.getRpConfig();

    // Get user's passkeys
    const passkeys = await this.passkeyRepository.findAllByUserIdWithCredentials({
      userId: params.userId,
    });

    if (passkeys.length === 0) {
      throw new BadRequestException("User has no registered passkeys");
    }

    const allowCredentials: PublicKeyCredentialDescriptorJSON[] = passkeys.map((passkey) => ({
      id: passkey.credentialId,
      type: "public-key" as const,
      transports: this.parseTransports(passkey.transports),
    }));

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials,
      userVerification: "preferred",
      timeout: 60000,
    });

    // Store the challenge for verification
    const pendingId = crypto.randomUUID();
    const expiration = new Date(Date.now() + this.challengeTtlSeconds * 1000);

    await this.pendingTwoFactorRepository.createForUser({
      pendingId,
      userId: params.userId,
      challenge: options.challenge,
      challengeType: "passkey-authentication",
      expiration,
    });

    return this.jsonApiService.buildSingle(PasskeyAuthenticationOptionsDescriptor.model, {
      id: pendingId,
      pendingId,
      options,
    });
  }

  /**
   * Verify a passkey authentication response.
   *
   * @param params.pendingId - The pending challenge ID from generateAuthenticationOptions
   * @param params.response - The WebAuthn assertion response from the client
   * @returns The passkey ID if verification succeeds
   */
  async verifyAuthentication(params: { pendingId: string; response: AuthenticationResponseJSON }): Promise<string> {
    const { rpId, origin } = this.getRpConfig();

    // Get the pending challenge
    const pendingData = await this.pendingTwoFactorRepository.findByIdWithUser({
      pendingId: params.pendingId,
    });

    if (!pendingData) {
      throw new NotFoundException("Authentication challenge not found or expired");
    }

    const { pending, userId: _userId } = pendingData;

    // Validate challenge type
    if (pending.challengeType !== "passkey-authentication") {
      throw new BadRequestException("Invalid challenge type");
    }

    // Check expiration
    if (new Date() > pending.expiration) {
      await this.pendingTwoFactorRepository.deletePending({ pendingId: params.pendingId });
      throw new BadRequestException("Authentication challenge has expired");
    }

    // Find the passkey by credential ID
    const passkey = await this.passkeyRepository.findByCredentialId({
      credentialId: params.response.id,
    });

    if (!passkey) {
      throw new BadRequestException("Passkey not found");
    }

    // Verify the authentication response
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: params.response,
        expectedChallenge: pending.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        credential: {
          // id is a Base64URL string
          id: passkey.credentialId,
          // publicKey is a Uint8Array
          publicKey: this.base64UrlToUint8Array(passkey.publicKey),
          counter: passkey.counter,
          transports: this.parseTransports(passkey.transports),
        },
        requireUserVerification: false,
      });
    } catch (error) {
      throw new BadRequestException(`Authentication verification failed: ${(error as Error).message}`);
    }

    if (!verification.verified) {
      throw new BadRequestException("Authentication verification failed");
    }

    // Update the passkey counter and last used time
    await this.passkeyRepository.updatePasskey({
      passkeyId: passkey.id,
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    });

    // Delete the pending challenge
    await this.pendingTwoFactorRepository.deletePending({ pendingId: params.pendingId });

    return passkey.id;
  }

  /**
   * List all passkeys for a user.
   *
   * @param params.userId - The user's ID
   * @returns JSON:API response with list of passkeys
   */
  async listPasskeys(params: { userId: string }): Promise<JsonApiListDocument> {
    const passkeys = await this.passkeyRepository.findByUserId({
      userId: params.userId,
    });

    return this.jsonApiService.buildList(PasskeyDescriptor.model, passkeys);
  }

  /**
   * Remove a passkey.
   *
   * @param params.passkeyId - The passkey ID to remove
   */
  async removePasskey(params: { passkeyId: string }): Promise<void> {
    const passkey = await this.passkeyRepository.findByIdForUser({
      passkeyId: params.passkeyId,
    });

    if (!passkey) {
      throw new NotFoundException("Passkey not found");
    }

    await this.passkeyRepository.deletePasskey({
      passkeyId: params.passkeyId,
    });
  }

  /**
   * Rename a passkey.
   *
   * @param params.passkeyId - The passkey ID to rename
   * @param params.name - The new name for the passkey
   */
  async renamePasskey(params: { passkeyId: string; name: string }): Promise<void> {
    const passkey = await this.passkeyRepository.findByIdForUser({
      passkeyId: params.passkeyId,
    });

    if (!passkey) {
      throw new NotFoundException("Passkey not found");
    }

    if (!params.name || params.name.trim().length === 0) {
      throw new BadRequestException("Passkey name cannot be empty");
    }

    await this.passkeyRepository.updatePasskey({
      passkeyId: params.passkeyId,
      name: params.name.trim(),
    });
  }

  /**
   * Check if a user has any registered passkeys.
   *
   * @param params.userId - The user's ID
   * @returns true if the user has at least one passkey
   */
  async hasPasskeys(params: { userId: string }): Promise<boolean> {
    const count = await this.passkeyRepository.countByUserId({
      userId: params.userId,
    });
    return count > 0;
  }

  /**
   * Parse transports JSON string into array.
   */
  private parseTransports(transportsJson: string): AuthenticatorTransportFuture[] {
    try {
      return JSON.parse(transportsJson) as AuthenticatorTransportFuture[];
    } catch {
      return [];
    }
  }

  /**
   * Convert Uint8Array to base64url string.
   */
  private uint8ArrayToBase64Url(array: Uint8Array): string {
    return Buffer.from(array).toString("base64url");
  }

  /**
   * Convert base64url string to Uint8Array.
   * The type assertion ensures compatibility with @simplewebauthn's expected types.
   */
  private base64UrlToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
    const buffer = Buffer.from(base64url, "base64url");
    // Create a proper ArrayBuffer-backed Uint8Array for WebAuthn compatibility
    const arrayBuffer = new ArrayBuffer(buffer.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    buffer.copy(uint8Array);
    return uint8Array;
  }
}
