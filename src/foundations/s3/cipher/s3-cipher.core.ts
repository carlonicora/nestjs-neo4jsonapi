import {
  AlgorithmSuiteIdentifier,
  buildClient,
  CommitmentPolicy,
  EncryptedDataKey,
  KeyringNode,
  MultiKeyringNode,
  NodeDecryptionMaterial,
  NodeEncryptionMaterial,
  RawAesKeyringNode,
  RawAesWrappingSuiteIdentifier,
} from "@aws-crypto/client-node";
import { createHmac, hkdfSync, timingSafeEqual } from "crypto";
import { Duplex } from "stream";
import { ConfigS3EncryptionInterface } from "../../../config/interfaces/config.s3.interface";

/**
 * S3 cipher core — Nest-free so the sweep CLI can import it directly.
 *
 * Envelope encryption per object with the AWS Encryption SDK: a fresh data key
 * per object, wrapped by a local AES-256 key (raw AES keyring). Retired keys stay
 * in the decrypt keyring so rotation never strands old objects.
 */

export const S3_ENCRYPTION_METADATA_KEY = "a360enc";
export const S3_ENCRYPTION_METADATA_VALUE = "esdk-1";
export const S3_ENCRYPTION_CONTEXT = { a360: "s3", v: "1" } as const;
export const S3_OBJECT_TOKEN_TTL_SECONDS = 3600;

const KEY_NAMESPACE = "a360ai";
const FRAME_LENGTH = 65536;
const SUITE_ID = AlgorithmSuiteIdentifier.ALG_AES256_GCM_IV12_TAG16_HKDF_SHA512_COMMIT_KEY;
const SIGNING_KEY_INFO = "a360ai/s3-url-signing";
const FALLBACK_SIGNING_KEY_INFO = "a360ai/s3-url-signing/jwt";
/** A raw AES keyring's provider info is the key name followed by tag length (4), IV length (4) and IV (12). */
const RAW_AES_PROVIDER_INFO_SUFFIX_BYTES = 20;

export type S3CipherKey = { keyId: string; material: Buffer };
export type S3CipherOptions = {
  enabled: boolean;
  key?: S3CipherKey;
  retiredKeys: S3CipherKey[];
  plaintextPrefixes: string[];
  /** JWT_SECRET; used to sign/verify object tokens when no `key` is configured. */
  fallbackSigningSecret?: string;
};
export type S3ObjectTokenOp = "get" | "put";
export type S3ObjectTokenPayload = {
  o: S3ObjectTokenOp;
  k: string;
  c?: string;
  f?: string;
  e?: number;
  /** Serve inline under `f` instead of as an attachment. */
  i?: 1;
  /** Max upload bytes (put tokens only). */
  m?: number;
};

export class S3ObjectTokenError extends Error {
  constructor(
    public readonly reason: "malformed" | "signature" | "expired" | "op",
    message: string,
  ) {
    super(message);
    this.name = "S3ObjectTokenError";
  }
}

/**
 * An encrypted object that no configured key opens. `keyIds` names the key(s) the object was
 * encrypted with, when known; `objectKey` the storage key, when the caller knows it.
 */
export class S3CipherKeyMissingError extends Error {
  constructor(
    public readonly keyIds: string[],
    public readonly objectKey?: string,
  ) {
    const object = objectKey ? `S3 object ${objectKey}` : "S3 object";
    super(
      keyIds.length
        ? `${object} is encrypted with key ${keyIds.join(", ")}, which is not configured in S3_ENCRYPTION_KEY or S3_ENCRYPTION_RETIRED_KEYS`
        : `${object} is encrypted but no matching S3_ENCRYPTION_KEY/RETIRED key is configured`,
    );
    this.name = "S3CipherKeyMissingError";
  }
}

export function parseS3CipherKey(raw: string, variable: string): S3CipherKey {
  const error = new Error(`${variable}: expected <keyId>:<base64 of 32 bytes>`);
  const separator = raw.indexOf(":");
  if (separator <= 0) throw error;

  const keyId = raw.slice(0, separator).trim();
  const encoded = raw.slice(separator + 1).trim();
  if (!keyId || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw error;

  const material = Buffer.from(encoded, "base64");
  if (material.length !== 32) throw error;

  return { keyId, material };
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseS3CipherOptions(config: ConfigS3EncryptionInterface): S3CipherOptions {
  const key = config.key ? parseS3CipherKey(config.key, "S3_ENCRYPTION_KEY") : undefined;

  if (config.enabled && !key) {
    throw new Error("S3_ENCRYPTION_KEY: required when S3_ENCRYPTION_ENABLED is true");
  }

  const retiredKeys = splitList(config.retiredKeys ?? "").map((raw) =>
    parseS3CipherKey(raw, "S3_ENCRYPTION_RETIRED_KEYS"),
  );

  const seen = new Set<string>();
  for (const candidate of [...(key ? [key] : []), ...retiredKeys]) {
    if (seen.has(candidate.keyId)) {
      throw new Error(
        `S3_ENCRYPTION_RETIRED_KEYS: duplicate keyId "${candidate.keyId}" across S3_ENCRYPTION_KEY and S3_ENCRYPTION_RETIRED_KEYS`,
      );
    }
    seen.add(candidate.keyId);
  }

  return {
    enabled: config.enabled,
    key,
    retiredKeys,
    plaintextPrefixes: splitList(config.plaintextPrefixes ?? ""),
  };
}

export function isEncryptedObjectMetadata(metadata: Record<string, string> | undefined): boolean {
  return metadata?.[S3_ENCRYPTION_METADATA_KEY] === S3_ENCRYPTION_METADATA_VALUE;
}

function buildKeyring(key: S3CipherKey): RawAesKeyringNode {
  return new RawAesKeyringNode({
    keyNamespace: KEY_NAMESPACE,
    keyName: key.keyId,
    unencryptedMasterKey: new Uint8Array(key.material),
    wrappingSuite: RawAesWrappingSuiteIdentifier.AES256_GCM_IV12_TAG16_NO_PADDING,
  });
}

/**
 * Delegates to the real decrypt keyring and records the key ids the message was encrypted with,
 * so a message no configured key opens can be reported by key id instead of the SDK's
 * "unencryptedDataKey has not been set". One instance per decryption.
 */
class KeyIdRecordingKeyring extends KeyringNode {
  readonly storedKeyIds: string[] = [];
  private asked = false;
  private unwrapped = false;

  constructor(private readonly inner: KeyringNode) {
    super();
  }

  async _onEncrypt(material: NodeEncryptionMaterial): Promise<NodeEncryptionMaterial> {
    return this.inner.onEncrypt(material);
  }

  async _onDecrypt(
    material: NodeDecryptionMaterial,
    encryptedDataKeys: EncryptedDataKey[],
  ): Promise<NodeDecryptionMaterial> {
    this.asked = true;
    for (const edk of encryptedDataKeys) {
      if (edk.providerId !== KEY_NAMESPACE || !edk.rawInfo) continue;
      const name = Buffer.from(edk.rawInfo.subarray(0, -RAW_AES_PROVIDER_INFO_SUFFIX_BYTES)).toString("utf8");
      if (name) this.storedKeyIds.push(name);
    }
    const result = await this.inner.onDecrypt(material, encryptedDataKeys);
    this.unwrapped = result.hasUnencryptedDataKey;
    return result;
  }

  /** A S3CipherKeyMissingError when the keyring was asked and no configured key unwrapped the data key; otherwise the SDK error. */
  translate(error: Error): Error {
    return this.asked && !this.unwrapped ? new S3CipherKeyMissingError(this.storedKeyIds) : error;
  }
}

function deriveSigningKey(key: S3CipherKey): Buffer {
  return Buffer.from(hkdfSync("sha256", key.material, "", SIGNING_KEY_INFO, 32));
}

function deriveFallbackSigningKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), "", FALLBACK_SIGNING_KEY_INFO, 32));
}

/** Key carried by an api object URL (`…/s3/objects/<payload>.<sig>`), WITHOUT verifying it; undefined otherwise. */
export function s3KeyFromObjectUrl(url: string): string | undefined {
  try {
    const match = new URL(url).pathname.match(/\/s3\/objects\/([^/]+)$/);
    if (!match) return undefined;

    const token = match[1];
    const separator = token.lastIndexOf(".");
    if (separator <= 0) return undefined;

    const payload = JSON.parse(Buffer.from(token.slice(0, separator), "base64url").toString("utf8"));
    return typeof payload?.k === "string" && payload.k.length > 0 ? payload.k : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Adapt an SDK stream to a native Node Duplex.
 *
 * - The SDK builds its streams on the `readable-stream` package, which fails `instanceof stream.Readable`
 *   (lib-storage's `Upload` rejects such a body), so callers get a native Duplex.
 * - Destroying an SDK stream mid-message throws an uncatchable "Premature close" from its internal
 *   pipeline (verified on @aws-crypto/client-node 5.0.2), which would crash the process on an
 *   oversized upload or an aborted download. So the SDK stream is never destroyed: when the native
 *   side is destroyed, the SDK stream is ended and drained, and its output discarded.
 * - Any SDK error destroys the native side, so the consumer sees it.
 */
function toNativeDuplex(
  sdkStream: Duplex,
  onSdkStream?: (fail: (error: Error) => void) => void,
  mapError: (error: Error) => Error = (error) => error,
): Duplex {
  let sdkEnded = false;
  const endSdk = () => {
    if (sdkEnded) return;
    sdkEnded = true;
    sdkStream.end();
  };

  const native = new Duplex({
    write(chunk, encoding, callback) {
      if (sdkStream.write(chunk, encoding)) callback();
      else sdkStream.once("drain", () => callback());
    },
    final(callback) {
      endSdk();
      callback();
    },
    read() {
      sdkStream.resume();
    },
    destroy(error, callback) {
      // Drain and end the SDK stream instead of destroying it (see above); its output is discarded.
      sdkStream.resume();
      endSdk();
      callback(error);
    },
  });

  sdkStream.on("data", (chunk: Buffer) => {
    if (native.destroyed) return;
    if (!native.push(chunk)) sdkStream.pause();
  });
  sdkStream.on("end", () => {
    if (!native.destroyed) native.push(null);
  });
  sdkStream.on("error", (error: Error) => native.destroy(mapError(error)));
  onSdkStream?.((error) => native.destroy(error));

  return native;
}

function assertEncryptionContext(context: Record<string, string> | undefined): void {
  for (const [name, value] of Object.entries(S3_ENCRYPTION_CONTEXT)) {
    if (context?.[name] !== value) {
      throw new Error(`S3 cipher: encryption context mismatch on "${name}"`);
    }
  }
}

export class S3Cipher {
  private readonly client = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT);
  private readonly encryptKeyring?: KeyringNode;
  private readonly decryptKeyring?: KeyringNode;
  /** Verification order: current key, retired keys, then the JWT_SECRET-derived key. */
  private readonly signingKeys: Buffer[];
  private readonly tokenSigningKey?: Buffer;

  constructor(private readonly options: S3CipherOptions) {
    const current = options.key ? buildKeyring(options.key) : undefined;
    const retired = options.retiredKeys.map(buildKeyring);

    this.encryptKeyring = current;
    if (current) {
      this.decryptKeyring = retired.length ? new MultiKeyringNode({ generator: current, children: retired }) : current;
    } else if (retired.length) {
      this.decryptKeyring = new MultiKeyringNode({ children: retired });
    }

    const fallbackSigningKey = options.fallbackSigningSecret
      ? deriveFallbackSigningKey(options.fallbackSigningSecret)
      : undefined;
    this.signingKeys = [
      ...[...(options.key ? [options.key] : []), ...options.retiredKeys].map(deriveSigningKey),
      ...(fallbackSigningKey ? [fallbackSigningKey] : []),
    ];
    this.tokenSigningKey = options.key ? deriveSigningKey(options.key) : fallbackSigningKey;
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  get canDecrypt(): boolean {
    return this.decryptKeyring !== undefined;
  }

  shouldEncrypt(key: string): boolean {
    if (!this.options.enabled) return false;
    return !this.options.plaintextPrefixes.some((prefix) => key.startsWith(prefix));
  }

  async encrypt(plaintext: Buffer): Promise<Buffer> {
    const { result } = await this.client.encrypt(this.requireEncryptKeyring(), plaintext, {
      suiteId: SUITE_ID,
      encryptionContext: { ...S3_ENCRYPTION_CONTEXT },
      frameLength: FRAME_LENGTH,
    });
    return Buffer.from(result);
  }

  async decrypt(ciphertext: Buffer): Promise<Buffer> {
    const keyring = new KeyIdRecordingKeyring(this.requireDecryptKeyring());
    let result: Awaited<ReturnType<typeof this.client.decrypt>>;
    try {
      result = await this.client.decrypt(keyring, ciphertext);
    } catch (error) {
      throw keyring.translate(error as Error);
    }
    assertEncryptionContext(result.messageHeader.encryptionContext);
    return Buffer.from(result.plaintext);
  }

  encryptStream(): Duplex {
    return toNativeDuplex(
      this.client.encryptStream(this.requireEncryptKeyring(), {
        suiteId: SUITE_ID,
        encryptionContext: { ...S3_ENCRYPTION_CONTEXT },
        frameLength: FRAME_LENGTH,
      }) as unknown as Duplex,
    );
  }

  decryptStream(): Duplex {
    const keyring = new KeyIdRecordingKeyring(this.requireDecryptKeyring());
    const stream = this.client.decryptUnsignedMessageStream(keyring) as unknown as Duplex;
    const native = toNativeDuplex(
      stream,
      (fail) =>
        stream.once("MessageHeader", (header: { encryptionContext?: Record<string, string> }) => {
          try {
            assertEncryptionContext(header?.encryptionContext);
          } catch (error) {
            fail(error as Error);
          }
        }),
      (error) => keyring.translate(error),
    );
    return native;
  }

  signObjectToken(input: {
    op: S3ObjectTokenOp;
    key: string;
    contentType?: string;
    filename?: string;
    /** Serve inline under `filename`; ignored without a filename. */
    inline?: boolean;
    /** Max upload bytes enforced on a put token, on top of the global cap. */
    maxBytes?: number;
    expiresInSeconds?: number;
    /** Absolute expiry (unix seconds); takes precedence over `expiresInSeconds`. */
    expiresAt?: number;
  }): string {
    const signingKey = this.tokenSigningKey;
    if (!signingKey) {
      throw new Error("S3 cipher: cannot sign an object token without S3_ENCRYPTION_KEY or JWT_SECRET");
    }

    const payload: S3ObjectTokenPayload = { o: input.op, k: input.key };
    if (input.contentType !== undefined) payload.c = input.contentType;
    if (input.filename !== undefined) payload.f = input.filename;
    if (input.inline === true && input.filename !== undefined) payload.i = 1;
    if (input.maxBytes !== undefined) payload.m = input.maxBytes;
    if (input.expiresAt !== undefined) {
      payload.e = input.expiresAt;
    } else if (input.expiresInSeconds !== undefined) {
      payload.e = Math.floor(Date.now() / 1000) + input.expiresInSeconds;
    }

    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${this.sign(signingKey, encoded)}`;
  }

  verifyObjectToken(token: string, op: S3ObjectTokenOp): S3ObjectTokenPayload {
    const separator = typeof token === "string" ? token.lastIndexOf(".") : -1;
    if (separator <= 0 || separator === token.length - 1) {
      throw new S3ObjectTokenError("malformed", "Malformed object token");
    }

    const encoded = token.slice(0, separator);
    const signature = Buffer.from(token.slice(separator + 1), "base64url");

    const valid = this.signingKeys.some((signingKey) => {
      const expected = Buffer.from(this.sign(signingKey, encoded), "base64url");
      return expected.length === signature.length && timingSafeEqual(expected, signature);
    });
    if (!valid) throw new S3ObjectTokenError("signature", "Invalid object token signature");

    let payload: S3ObjectTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new S3ObjectTokenError("malformed", "Malformed object token payload");
    }
    if (!payload || typeof payload !== "object" || typeof payload.k !== "string" || !payload.k) {
      throw new S3ObjectTokenError("malformed", "Malformed object token payload");
    }

    if (payload.e !== undefined && payload.e < Math.floor(Date.now() / 1000)) {
      throw new S3ObjectTokenError("expired", "Object token expired");
    }
    if (payload.o !== op) throw new S3ObjectTokenError("op", `Object token is not valid for "${op}"`);

    return payload;
  }

  private sign(signingKey: Buffer, encodedPayload: string): string {
    return createHmac("sha256", signingKey).update(encodedPayload).digest("base64url");
  }

  private requireEncryptKeyring(): KeyringNode {
    if (!this.encryptKeyring) throw new Error("S3 cipher: S3_ENCRYPTION_KEY is not configured");
    return this.encryptKeyring;
  }

  private requireDecryptKeyring(): KeyringNode {
    if (!this.decryptKeyring) throw new Error("S3 cipher: no S3 encryption key is configured, cannot decrypt");
    return this.decryptKeyring;
  }
}
