import { vi, describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { S3CipherService } from "../s3-cipher.service";

async function build(s3: unknown, jwt?: unknown): Promise<S3CipherService> {
  const get = vi.fn((name: string) => (name === "s3" ? s3 : name === "jwt" ? jwt : undefined));
  const module = await Test.createTestingModule({
    providers: [S3CipherService, { provide: ConfigService, useValue: { get } }],
  }).compile();
  return module.get(S3CipherService);
}

const s3Config = (encryption: Record<string, unknown>) => ({
  type: "minio",
  bucket: "b",
  uploadMaxBytes: 104857600,
  encryption: { enabled: false, key: "", retiredKeys: "", plaintextPrefixes: "", ...encryption },
});

describe("S3CipherService", () => {
  it("boots inert when disabled and no key", async () => {
    const service = await build(s3Config({}));
    expect(service.enabled).toBe(false);
    expect(service.canDecrypt).toBe(false);
  });

  it("throws from the constructor when enabled without a key", async () => {
    await expect(build(s3Config({ enabled: true }))).rejects.toThrow(/S3_ENCRYPTION_KEY/);
  });

  it("exposes uploadMaxBytes from config", async () => {
    const service = await build(s3Config({}));
    expect(service.uploadMaxBytes).toBe(104857600);
  });

  it("passes JWT_SECRET as the fallback signing secret", async () => {
    const service = await build(s3Config({}), { secret: "s" });
    const token = service.signObjectToken({ op: "get", key: "k" });
    expect(service.verifyObjectToken(token, "get").k).toBe("k");
  });

  it("passes expiresAt through to the token", async () => {
    const service = await build(s3Config({}), { secret: "s" });
    const token = service.signObjectToken({ op: "get", key: "k", expiresAt: 2000000000 });
    expect(service.verifyObjectToken(token, "get").e).toBe(2000000000);
  });
});
