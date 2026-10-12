export interface ConfigS3EncryptionInterface {
  enabled: boolean;
  /** Raw `<keyId>:<base64 of 32 bytes>`, or "" when not configured. */
  key: string;
  /** Raw comma-separated list of `<keyId>:<base64>` keys kept for decryption only, or "". */
  retiredKeys: string;
  /** Raw comma-separated list of key prefixes that stay plaintext, or "". */
  plaintextPrefixes: string;
}

export interface ConfigS3Interface {
  type: string;
  region: string;
  bucket: string;
  key: string;
  secret: string;
  endpoint: string;
  /**
   * Seconds for which a signed read link stays identical, so browser and image
   * proxy caches can hit. Defaults to 3600.
   */
  signingWindowSeconds: number;
  encryption: ConfigS3EncryptionInterface;
  uploadMaxBytes: number;
}
