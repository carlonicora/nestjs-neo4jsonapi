import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelWeight } from "../../enums/model.weight";
import { LLMCacheService, buildCacheKey } from "../llm-cache.service";

/**
 * The cache talks to Redis through an ioredis-shaped client. We mock only the
 * two methods the service uses (`get` and `set`) so the suite never touches a
 * real Redis. The service constructs its own client from ConfigService (the
 * package convention — every Redis service does `new Redis(config)`), so we
 * inject the mock via the constructor's optional override seam.
 */
function makeService(client: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }): LLMCacheService {
  const configService = {
    get: vi.fn(() => ({ host: "localhost", port: 6379, username: "", password: "" })),
  } as any;
  return new LLMCacheService(configService, client as any);
}

describe("buildCacheKey", () => {
  const base = {
    modelWeight: ModelWeight.Normal,
    temperature: 0.2,
    systemPrompts: ["sys-a", "sys-b"],
    prompt: "hello",
  };

  it("produces a deterministic, llm-prefixed key for identical params", () => {
    const a = buildCacheKey(base);
    const b = buildCacheKey({ ...base });
    expect(a).toBe(b);
    expect(a.startsWith("llm:")).toBe(true);
  });

  it("changes when CACHE_VERSION changes", () => {
    const original = process.env.CACHE_VERSION;
    try {
      process.env.CACHE_VERSION = "v1";
      const v1 = buildCacheKey(base);
      process.env.CACHE_VERSION = "v2";
      const v2 = buildCacheKey(base);
      expect(v1).not.toBe(v2);
    } finally {
      if (original === undefined) delete process.env.CACHE_VERSION;
      else process.env.CACHE_VERSION = original;
    }
  });

  it("changes when any generic param changes", () => {
    const k = buildCacheKey(base);
    expect(buildCacheKey({ ...base, modelWeight: ModelWeight.Large })).not.toBe(k);
    expect(buildCacheKey({ ...base, temperature: 0.9 })).not.toBe(k);
    expect(buildCacheKey({ ...base, prompt: "world" })).not.toBe(k);
    expect(buildCacheKey({ ...base, systemPrompts: ["sys-a"] })).not.toBe(k);
  });
});

describe("LLMCacheService", () => {
  let client: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let service: LLMCacheService;

  beforeEach(() => {
    client = { get: vi.fn(), set: vi.fn() };
    service = makeService(client);
  });

  describe("get", () => {
    it("returns null on a miss", async () => {
      client.get.mockResolvedValue(null);
      await expect(service.get("llm:x")).resolves.toBeNull();
    });

    it("returns the parsed value on a hit", async () => {
      client.get.mockResolvedValue(JSON.stringify({ answer: 42 }));
      await expect(service.get<{ answer: number }>("llm:x")).resolves.toEqual({ answer: 42 });
    });

    it("swallows a redis error and returns null (pass-through)", async () => {
      client.get.mockRejectedValue(new Error("redis down"));
      await expect(service.get("llm:x")).resolves.toBeNull();
    });
  });

  describe("set", () => {
    it("write-throughs the JSON-stringified value with an EX ttl", async () => {
      client.set.mockResolvedValue("OK");
      await service.set("llm:x", { answer: 42 }, 60);
      expect(client.set).toHaveBeenCalledWith("llm:x", JSON.stringify({ answer: 42 }), "EX", 60);
    });

    it("defaults the ttl to 24h", async () => {
      client.set.mockResolvedValue("OK");
      await service.set("llm:x", { answer: 42 });
      expect(client.set).toHaveBeenCalledWith("llm:x", JSON.stringify({ answer: 42 }), "EX", 24 * 60 * 60);
    });

    it("swallows a redis error and does not throw", async () => {
      client.set.mockRejectedValue(new Error("redis down"));
      await expect(service.set("llm:x", { answer: 42 })).resolves.toBeUndefined();
    });
  });

  describe("set then get round-trip", () => {
    it("returns the value that was set", async () => {
      const store = new Map<string, string>();
      client.set.mockImplementation(async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      });
      client.get.mockImplementation(async (key: string) => store.get(key) ?? null);

      await service.set("llm:roundtrip", { hello: "world" });
      await expect(service.get<{ hello: string }>("llm:roundtrip")).resolves.toEqual({ hello: "world" });
    });
  });
});
