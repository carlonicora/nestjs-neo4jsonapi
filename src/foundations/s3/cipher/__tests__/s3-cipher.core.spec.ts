import { describe, expect, it } from "vitest";
import { pipeline as streamPipeline, Readable, Transform, Writable } from "stream";
import { pipeline } from "stream/promises";
import {
  parseS3CipherKey,
  parseS3CipherOptions,
  S3Cipher,
  S3CipherOptions,
  S3ObjectTokenError,
  s3KeyFromObjectUrl,
} from "../s3-cipher.core";

const KEY_A = "a:" + Buffer.alloc(32, 1).toString("base64");
const KEY_B = "b:" + Buffer.alloc(32, 2).toString("base64");
const FALLBACK = "jwt-secret-for-tests";

function options(
  overrides: Partial<{ enabled: boolean; key: string; retiredKeys: string; plaintextPrefixes: string }> = {},
): S3CipherOptions {
  return parseS3CipherOptions({ enabled: true, key: KEY_A, retiredKeys: "", plaintextPrefixes: "", ...overrides });
}

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.slice(0, token.lastIndexOf(".")), "base64url").toString("utf8"));
}

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(S3ObjectTokenError);
    return (error as S3ObjectTokenError).reason;
  }
  return undefined;
}

describe("S3 cipher core", () => {
  it("parseS3CipherKey rejects a key that is not 32 bytes", () =>
    expect(() => parseS3CipherKey("a:" + Buffer.alloc(16).toString("base64"), "S3_ENCRYPTION_KEY")).toThrow(
      "S3_ENCRYPTION_KEY: expected <keyId>:<base64 of 32 bytes>",
    ));

  it("parseS3CipherOptions throws when enabled without a key", () =>
    expect(() => parseS3CipherOptions({ enabled: true, key: "", retiredKeys: "", plaintextPrefixes: "" })).toThrow(
      /S3_ENCRYPTION_KEY/,
    ));

  it("parseS3CipherOptions throws on a duplicate keyId across current and retired", () =>
    expect(() =>
      parseS3CipherOptions({
        enabled: true,
        key: KEY_A,
        retiredKeys: "a:" + Buffer.alloc(32, 3).toString("base64"),
        plaintextPrefixes: "",
      }),
    ).toThrow(/duplicate keyId/));

  it("parseS3CipherOptions splits and trims plaintext prefixes and drops empties", () => {
    const opts = options({ plaintextPrefixes: " judgements/ ,, laws/ ," });
    expect(opts.plaintextPrefixes).toEqual(["judgements/", "laws/"]);
  });

  it("shouldEncrypt is false when disabled, false under a plaintext prefix, true otherwise", () => {
    expect(new S3Cipher(options({ enabled: false })).shouldEncrypt("documents/x.pdf")).toBe(false);
    const c = new S3Cipher(options({ plaintextPrefixes: "judgements/,laws/" }));
    expect(c.shouldEncrypt("judgements/x.pdf")).toBe(false);
    expect(c.shouldEncrypt("documents/x.pdf")).toBe(true);
  });

  it("encrypts and decrypts a buffer", async () => {
    const c = new S3Cipher(options());
    expect(await c.decrypt(await c.encrypt(Buffer.from("hello")))).toEqual(Buffer.from("hello"));
  });

  it("encrypts and decrypts an empty buffer", async () => {
    const c = new S3Cipher(options());
    const ciphertext = await c.encrypt(Buffer.alloc(0));
    expect(ciphertext.length).toBeGreaterThan(0);
    expect(await c.decrypt(ciphertext)).toEqual(Buffer.alloc(0));
  });

  it("round-trips 3 MiB through encryptStream and decryptStream with pipeline", async () => {
    const c = new S3Cipher(options());
    const plaintext = Buffer.alloc(3 * 1024 * 1024);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = i % 251;

    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });

    await pipeline(Readable.from([plaintext]), c.encryptStream(), c.decryptStream(), sink);
    expect(Buffer.concat(chunks).equals(plaintext)).toBe(true);
  });

  it("returns native Node streams (lib-storage's Upload accepts only `instanceof stream.Readable`)", () => {
    const c = new S3Cipher(options());
    expect(c.encryptStream()).toBeInstanceOf(Readable);
    expect(c.decryptStream()).toBeInstanceOf(Readable);
  });

  it("an error upstream of encryptStream reaches its readable side (so a multipart upload aborts)", async () => {
    const c = new S3Cipher(options());
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > 100) return callback(new Error("too large"));
        callback(null, chunk);
      },
    });
    const encrypting = c.encryptStream();
    Readable.from([Buffer.alloc(80), Buffer.alloc(80)]).pipe(counter);
    streamPipeline(counter, encrypting, () => undefined);

    const drain = async () => {
      for await (const _chunk of encrypting) {
        // consume
      }
    };
    await expect(drain()).rejects.toThrow("too large");
  });

  it("destroying a decrypt stream mid-message (an aborted download) raises no stray error", async () => {
    const c = new S3Cipher(options());
    const ciphertext = await c.encrypt(Buffer.alloc(300_000, 3));
    const decrypting = c.decryptStream();
    decrypting.on("error", () => undefined);
    decrypting.write(ciphertext.subarray(0, 100_000));
    await new Promise((resolve) => setTimeout(resolve, 50));

    decrypting.destroy(new Error("client went away"));
    // An uncaught "Premature close" from the SDK would surface here as a Vitest unhandled error.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(decrypting.destroyed).toBe(true);
  });

  it("surfaces a tampered stream as an error on the decrypt stream's readable side", async () => {
    const c = new S3Cipher(options());
    const ciphertext = await c.encrypt(Buffer.alloc(200_000, 7));
    ciphertext[ciphertext.length - 100] ^= 0xff;

    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    await expect(pipeline(Readable.from([ciphertext]), c.decryptStream(), sink)).rejects.toThrow();
  });

  it("decrypts with a retired key what the old current key encrypted", async () => {
    const a = new S3Cipher(options());
    const b = new S3Cipher(options({ key: KEY_B, retiredKeys: KEY_A }));
    const ciphertext = await a.encrypt(Buffer.from("rotated"));
    expect(await b.decrypt(ciphertext)).toEqual(Buffer.from("rotated"));
  });

  it("fails to decrypt a tampered ciphertext", async () => {
    const c = new S3Cipher(options());
    const ciphertext = await c.encrypt(Buffer.from("x".repeat(200)));
    const offset = ciphertext.length - 40;
    expect(offset).toBeGreaterThan(64);
    ciphertext[offset] ^= 0xff;
    await expect(c.decrypt(ciphertext)).rejects.toThrow();
  });

  it("fails to decrypt when no key is configured", async () => {
    const ciphertext = await new S3Cipher(options()).encrypt(Buffer.from("hello"));
    const keyless = new S3Cipher(options({ enabled: false, key: "" }));
    expect(keyless.canDecrypt).toBe(false);
    await expect(keyless.decrypt(ciphertext)).rejects.toThrow();
  });

  it("signObjectToken/verifyObjectToken round-trip a get token with filename and expiry", () => {
    const c = new S3Cipher(options());
    const token = c.signObjectToken({
      op: "get",
      key: "documents/x.pdf",
      contentType: "application/pdf",
      filename: "Atto è.pdf",
      expiresInSeconds: 3600,
    });
    const payload = c.verifyObjectToken(token, "get");
    expect(payload).toMatchObject({ o: "get", k: "documents/x.pdf", c: "application/pdf", f: "Atto è.pdf" });
    expect(payload.e).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("verifyObjectToken rejects a wrong op with reason 'op'", () => {
    const c = new S3Cipher(options());
    const token = c.signObjectToken({ op: "get", key: "k", expiresInSeconds: 3600 });
    expect(reasonOf(() => c.verifyObjectToken(token, "put"))).toBe("op");
  });

  it("verifyObjectToken rejects an expired token with reason 'expired'", () => {
    const c = new S3Cipher(options());
    const token = c.signObjectToken({ op: "get", key: "k", expiresInSeconds: -1 });
    expect(reasonOf(() => c.verifyObjectToken(token, "get"))).toBe("expired");
  });

  it("verifyObjectToken rejects a tampered signature with reason 'signature'", () => {
    const c = new S3Cipher(options());
    const token = c.signObjectToken({ op: "get", key: "k", expiresInSeconds: 3600 });
    const sig = token.slice(token.lastIndexOf(".") + 1);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(reasonOf(() => c.verifyObjectToken(token.slice(0, token.lastIndexOf(".") + 1) + flipped, "get"))).toBe(
      "signature",
    );
  });

  it("verifyObjectToken accepts a token signed by a now-retired key", () => {
    const a = new S3Cipher(options());
    const b = new S3Cipher(options({ key: KEY_B, retiredKeys: KEY_A }));
    const token = a.signObjectToken({ op: "get", key: "k", expiresInSeconds: 3600 });
    expect(b.verifyObjectToken(token, "get").k).toBe("k");
  });

  it("verifyObjectToken rejects a token signed by an unknown key", () => {
    const a = new S3Cipher(options());
    const b = new S3Cipher(options({ key: KEY_B }));
    const token = a.signObjectToken({ op: "get", key: "k", expiresInSeconds: 3600 });
    expect(reasonOf(() => b.verifyObjectToken(token, "get"))).toBe("signature");
  });

  it("a public token has no e field", () => {
    const c = new S3Cipher(options());
    const token = c.signObjectToken({ op: "get", key: "k" });
    const decoded = decodePayload(token);
    expect(decoded.e).toBeUndefined();
    expect(c.verifyObjectToken(token, "get").e).toBeUndefined();
  });
  describe("JWT_SECRET fallback signing", () => {
    const fallbackOnly = (secret: string = FALLBACK) =>
      new S3Cipher({ enabled: false, retiredKeys: [], plaintextPrefixes: [], fallbackSigningSecret: secret });

    it("signs with the JWT_SECRET fallback when no encryption key is configured", () => {
      const c = fallbackOnly();
      expect(c.verifyObjectToken(c.signObjectToken({ op: "get", key: "k" }), "get").k).toBe("k");
    });

    it("verifies a JWT_SECRET-signed token after an encryption key is added", () => {
      const token = fallbackOnly().signObjectToken({ op: "get", key: "k" });
      const withKey = new S3Cipher({ ...options(), fallbackSigningSecret: FALLBACK });
      expect(withKey.verifyObjectToken(token, "get").k).toBe("k");
    });

    it("signs with the encryption key, not the fallback, when both are configured", () => {
      const both = new S3Cipher({ ...options(), fallbackSigningSecret: FALLBACK });
      const token = both.signObjectToken({ op: "get", key: "k" });
      expect(new S3Cipher(options()).verifyObjectToken(token, "get").k).toBe("k");
      expect(reasonOf(() => fallbackOnly().verifyObjectToken(token, "get"))).toBe("signature");
    });

    it("rejects a fallback-signed token when the JWT_SECRET changed", () => {
      const token = fallbackOnly().signObjectToken({ op: "get", key: "k" });
      expect(reasonOf(() => fallbackOnly("a-rotated-jwt-secret").verifyObjectToken(token, "get"))).toBe("signature");
    });

    it("still throws when neither key nor fallback secret is configured", () =>
      expect(() =>
        new S3Cipher({ enabled: false, retiredKeys: [], plaintextPrefixes: [] }).signObjectToken({
          op: "get",
          key: "k",
        }),
      ).toThrow(/S3_ENCRYPTION_KEY/));
  });

  it("uses expiresAt verbatim as e, ahead of expiresInSeconds", () => {
    const c = new S3Cipher(options());
    expect(
      decodePayload(c.signObjectToken({ op: "get", key: "k", expiresAt: 2000000000, expiresInSeconds: 5 })).e,
    ).toBe(2000000000);
  });

  it("s3KeyFromObjectUrl returns the key of an api object URL", () => {
    const token = new S3Cipher(options()).signObjectToken({ op: "get", key: "companies/c1/a b/è.pdf" });
    expect(s3KeyFromObjectUrl(`http://api.test/s3/objects/${token}`)).toBe("companies/c1/a b/è.pdf");
  });

  it.each([["http://minio.test:9000/bucket/k.pdf"], ["http://api.test/s3/objects/!!!"], [""]])(
    "s3KeyFromObjectUrl returns undefined for a storage URL or garbage (%s)",
    (url) => expect(s3KeyFromObjectUrl(url)).toBeUndefined(),
  );
});
