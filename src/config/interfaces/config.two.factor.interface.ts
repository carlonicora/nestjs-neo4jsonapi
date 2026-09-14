/**
 * Two-factor authentication configuration interface
 */
export interface ConfigTwoFactorInterface {
  /**
   * 64-character hex string (32 bytes) for AES-256-GCM encryption of TOTP secrets
   */
  totpEncryptionKey: string;

  /**
   * Issuer shown by authenticator apps beside a TOTP entry — the application's
   * human-readable name. It is metadata only: it appears in the otpauth:// URI
   * and therefore in the QR code, and takes no part in generating or validating
   * a code. Defaults to `webauthnRpName` so both security prompts agree.
   */
  totpIssuer: string;

  /**
   * WebAuthn Relying Party ID — the registrable domain (e.g., 'example.com')
   */
  webauthnRpId: string;

  /**
   * Human-readable Relying Party name shown in passkey prompts
   */
  webauthnRpName: string;

  /**
   * Expected origin URL(s) for WebAuthn (e.g., 'https://example.com')
   * Can be a single origin or an array for multiple origins
   */
  webauthnOrigin: string | string[];

  /**
   * Pending two-factor token TTL in seconds (default 300)
   */
  pendingTtl: number;
}
