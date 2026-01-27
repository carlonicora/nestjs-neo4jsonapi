/**
 * Two-factor authentication configuration interface
 */
export interface ConfigTwoFactorInterface {
  /**
   * 64-character hex string (32 bytes) for AES-256-GCM encryption of TOTP secrets
   */
  totpEncryptionKey: string;

  /**
   * WebAuthn Relying Party ID (e.g., 'only35.app')
   */
  webauthnRpId: string;

  /**
   * Human-readable Relying Party name (e.g., 'Only35')
   */
  webauthnRpName: string;

  /**
   * Expected origin URL(s) for WebAuthn (e.g., 'https://only35.app')
   * Can be a single origin or an array for multiple origins
   */
  webauthnOrigin: string | string[];

  /**
   * Pending two-factor token TTL in seconds (default 300)
   */
  pendingTtl: number;
}
