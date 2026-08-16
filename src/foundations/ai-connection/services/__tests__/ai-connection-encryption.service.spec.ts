import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../config/base.config", () => ({
  baseConfig: { encryption: { key: "a".repeat(64) } },
}));

import { AiConnectionEncryptionService } from "../ai-connection-encryption.service";

describe("AiConnectionEncryptionService", () => {
  let service: AiConnectionEncryptionService;
  beforeEach(() => {
    service = new AiConnectionEncryptionService();
  });

  it("round-trips a secret", () => {
    const encrypted = service.encrypt("sk-super-secret");
    expect(encrypted).not.toContain("sk-super-secret");
    expect(service.decrypt(encrypted)).toBe("sk-super-secret");
  });

  it("produces a different ciphertext per call (random IV)", () => {
    expect(service.encrypt("x")).not.toBe(service.encrypt("x"));
  });

  it("reports configured", () => {
    expect(service.isConfigured()).toBe(true);
  });
});
