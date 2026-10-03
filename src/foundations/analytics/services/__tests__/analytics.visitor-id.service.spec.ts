import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsVisitorIdService } from "../analytics.visitor-id.service";

describe("AnalyticsVisitorIdService", () => {
  let redisClient: { set: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let service: AnalyticsVisitorIdService;
  beforeEach(() => {
    redisClient = { set: vi.fn(async () => "OK"), get: vi.fn(async () => "salt-A") };
    service = new AnalyticsVisitorIdService(
      { getRedisClient: () => redisClient } as any,
      { warn: vi.fn(), debug: vi.fn() } as any,
    );
  });
  it("uses the cookie id, prefixed, when present", async () => {
    await expect(
      service.resolve({
        visitorId: "6f1c2d3e-0000-4000-8000-000000000001",
        clientIp: "1.1.1.1",
        userAgent: "ua",
        receivedAt: "2026-10-03T10:00:00Z",
      }),
    ).resolves.toEqual({ visitorId: "c:6f1c2d3e-0000-4000-8000-000000000001", consented: true });
  });
  it("hashes ip + user agent with the day's salt and never echoes either", async () => {
    const a = await service.resolve({ clientIp: "1.1.1.1", userAgent: "ua", receivedAt: "2026-10-03T10:00:00Z" });
    const b = await service.resolve({ clientIp: "1.1.1.1", userAgent: "ua", receivedAt: "2026-10-03T23:00:00Z" });
    expect(a).toEqual(b);
    expect(a.consented).toBe(false);
    expect(a.visitorId).toMatch(/^d:[0-9a-f]{64}$/);
    expect(a.visitorId).not.toContain("1.1.1.1");
  });
  it("yields a different id under a different salt", async () => {
    const a = await service.resolve({ clientIp: "1.1.1.1", userAgent: "ua", receivedAt: "2026-10-03T10:00:00Z" });
    redisClient.get.mockResolvedValueOnce("salt-B");
    const b = await service.resolve({ clientIp: "1.1.1.1", userAgent: "ua", receivedAt: "2026-10-04T10:00:00Z" });
    expect(a.visitorId).not.toBe(b.visitorId);
  });
  it("creates the salt with set-if-absent and a 48h expiry", async () => {
    await service.dailySalt("2026-10-03");
    expect(redisClient.set).toHaveBeenCalledWith("analytics:salt:2026-10-03", expect.any(String), "EX", 172800, "NX");
    expect(redisClient.get).toHaveBeenCalledWith("analytics:salt:2026-10-03");
  });
  it("falls back to a process-local salt when Redis throws", async () => {
    redisClient.set.mockRejectedValue(new Error("down"));
    const salt = await service.dailySalt("2026-10-03");
    expect(salt).toHaveLength(64);
    expect(await service.dailySalt("2026-10-03")).toBe(salt);
  });
  it("classifies bots and device types", () => {
    expect(service.isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(service.isBot("curl/8.0")).toBe(true);
    expect(service.isBot("Mozilla/5.0 (Macintosh) Safari/605")).toBe(false);
    expect(service.deviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari")).toBe("mobile");
    expect(service.deviceType("Mozilla/5.0 (iPad; CPU OS 17_0)")).toBe("tablet");
    expect(service.deviceType("Mozilla/5.0 (Macintosh)")).toBe("desktop");
  });
});
