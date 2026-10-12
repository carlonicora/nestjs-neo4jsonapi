import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Duplex } from "stream";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigJwtInterface } from "../../../config/interfaces/config.jwt.interface";
import { ConfigS3Interface } from "../../../config/interfaces/config.s3.interface";
import { parseS3CipherOptions, S3Cipher, S3ObjectTokenOp, S3ObjectTokenPayload } from "../cipher/s3-cipher.core";

const DEFAULT_UPLOAD_MAX_BYTES = 104857600;

/**
 * Nest wrapper around the Nest-free {@link S3Cipher}. Delegation only.
 *
 * Builds the cipher from `s3.encryption`; a malformed key (or encryption enabled
 * without one) throws here, so the app fails at boot on first injection.
 */
@Injectable()
export class S3CipherService {
  readonly uploadMaxBytes: number;
  private readonly cipher: S3Cipher;

  constructor(private readonly configService: ConfigService<BaseConfigInterface>) {
    const s3 = this.configService.get<ConfigS3Interface>("s3");
    this.cipher = new S3Cipher({
      ...parseS3CipherOptions(s3?.encryption ?? { enabled: false, key: "", retiredKeys: "", plaintextPrefixes: "" }),
      fallbackSigningSecret: this.configService.get<ConfigJwtInterface>("jwt")?.secret || undefined,
    });
    this.uploadMaxBytes = s3?.uploadMaxBytes || DEFAULT_UPLOAD_MAX_BYTES;
  }

  get enabled(): boolean {
    return this.cipher.enabled;
  }

  get canDecrypt(): boolean {
    return this.cipher.canDecrypt;
  }

  shouldEncrypt(key: string): boolean {
    return this.cipher.shouldEncrypt(key);
  }

  encrypt(plaintext: Buffer): Promise<Buffer> {
    return this.cipher.encrypt(plaintext);
  }

  decrypt(ciphertext: Buffer): Promise<Buffer> {
    return this.cipher.decrypt(ciphertext);
  }

  encryptStream(): Duplex {
    return this.cipher.encryptStream();
  }

  decryptStream(): Duplex {
    return this.cipher.decryptStream();
  }

  signObjectToken(input: {
    op: S3ObjectTokenOp;
    key: string;
    contentType?: string;
    filename?: string;
    expiresInSeconds?: number;
    expiresAt?: number;
  }): string {
    return this.cipher.signObjectToken(input);
  }

  verifyObjectToken(token: string, op: S3ObjectTokenOp): S3ObjectTokenPayload {
    return this.cipher.verifyObjectToken(token, op);
  }
}
