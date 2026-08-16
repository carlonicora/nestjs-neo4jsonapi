import { Injectable } from "@nestjs/common";
import * as crypto from "crypto";
import { baseConfig } from "../../../config/base.config";

/**
 * AI Connection Encryption Service
 *
 * Provides AES-256-GCM encryption/decryption for AI connection secrets
 * (`apiKey`, `googleCredentialsBase64`). Secrets are encrypted before storage in
 * Neo4j and decrypted only when the resolver builds a candidate — they are never
 * serialised back over the API.
 *
 * Mirrors {@link TotpEncryptionService} (the in-package AES-256-GCM canonical),
 * keyed from `encryption.key` (ENCRYPTION_KEY) instead of the TOTP key.
 *
 * Format: IV (12 bytes) + AuthTag (16 bytes) + Ciphertext (base64 encoded)
 */
@Injectable()
export class AiConnectionEncryptionService {
  private readonly algorithm = "aes-256-gcm";
  private readonly ivLength = 12; // 96 bits for GCM
  private readonly authTagLength = 16; // 128 bits

  /**
   * Whether a key is configured at all. Writing a secret without one must fail
   * loudly at the admin API (fail-closed on write, fail-open on read).
   */
  isConfigured(): boolean {
    return !!baseConfig.encryption.key;
  }

  /**
   * Get the encryption key from config.
   * The key must be exactly 32 bytes (256 bits) for AES-256.
   */
  private getKey(): Buffer {
    const keyString = baseConfig.encryption.key;

    if (!keyString) {
      throw new Error("ENCRYPTION_KEY is not configured — cannot store AI connection secrets");
    }

    // If the key is hex-encoded (64 chars = 32 bytes), decode it
    if (keyString.length === 64 && /^[0-9a-fA-F]+$/.test(keyString)) {
      return Buffer.from(keyString, "hex");
    }

    // If the key is base64-encoded
    if (keyString.length === 44 && keyString.endsWith("=")) {
      const decoded = Buffer.from(keyString, "base64");
      if (decoded.length === 32) {
        return decoded;
      }
    }

    // Otherwise, derive a 32-byte key using SHA-256
    return crypto.createHash("sha256").update(keyString).digest();
  }

  /**
   * Encrypt an AI connection secret using AES-256-GCM.
   *
   * @param plaintext - The secret to encrypt (API key or base64 GCP credentials)
   * @returns The encrypted secret as a base64-encoded string containing IV, auth tag, and ciphertext
   */
  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    const authTag = cipher.getAuthTag();

    // Combine IV + AuthTag + Ciphertext
    const combined = Buffer.concat([iv, authTag, encrypted]);

    return combined.toString("base64");
  }

  /**
   * Decrypt an AI connection secret encrypted with AES-256-GCM.
   *
   * @param ciphertext - The base64-encoded encrypted secret (IV + AuthTag + Ciphertext)
   * @returns The decrypted secret
   * @throws Error if decryption fails (invalid key, corrupted data, or tampered data)
   */
  decrypt(ciphertext: string): string {
    const key = this.getKey();
    const combined = Buffer.from(ciphertext, "base64");

    // Extract IV, AuthTag, and encrypted data
    const iv = combined.subarray(0, this.ivLength);
    const authTag = combined.subarray(this.ivLength, this.ivLength + this.authTagLength);
    const encrypted = combined.subarray(this.ivLength + this.authTagLength);

    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return decrypted.toString("utf8");
  }

  /**
   * Verify that the encryption system is properly configured.
   * Performs a round-trip encryption/decryption test.
   *
   * @returns true if encryption is working correctly
   * @throws Error if encryption is not properly configured
   */
  verify(): boolean {
    const testData = "test-secret-" + crypto.randomBytes(8).toString("hex");
    const encrypted = this.encrypt(testData);
    const decrypted = this.decrypt(encrypted);
    return decrypted === testData;
  }
}
