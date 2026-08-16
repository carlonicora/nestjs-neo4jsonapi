import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiConnectionResolverService } from "../ai-connection-resolver.service";

/**
 * Unit tests for the fallback-chain resolver (spec § 2 "Resolution & failover",
 * spec § 5 "Error handling"). The service is constructed directly with mocks —
 * no Nest testing module — so every branch is exercised without a container.
 */

// --- fixtures -------------------------------------------------------------

/** The encryption stub stores secrets as `enc(<plaintext>)`. */
const enc = (plaintext: string) => `enc(${plaintext})`;

/** A stored secret that the encryption stub refuses to decrypt. */
const BROKEN_SECRET = "enc-broken";

const makeConnection = (over: Record<string, any> = {}): any => ({
  id: "conn-1",
  name: "Connection",
  connectionType: "ai",
  provider: "openrouter",
  position: 0,
  enabled: true,
  model: "db-model",
  url: "https://openrouter.ai/api/v1",
  apiKey: enc("db-key"),
  ...over,
});

const makeAiConfig = (over: Record<string, any> = {}): any => ({
  connectionCooldownMinutes: 5,
  ai: {
    provider: "openrouter",
    apiKey: "env-key",
    model: "env-model",
    url: "https://openrouter.ai/api/v1",
    inputCostPer1MTokens: 1,
    outputCostPer1MTokens: 2,
    cachedInputCostPer1MTokens: 0.5,
  },
  aiLite: { provider: "openrouter", apiKey: "env-key", model: "env-lite", url: "https://openrouter.ai/api/v1" },
  aiLarge: { provider: "openrouter", apiKey: "env-key", model: "env-large", url: "https://openrouter.ai/api/v1" },
  vision: { provider: "openrouter", apiKey: "env-key", model: "env-vision", url: "https://openrouter.ai/api/v1" },
  audio: {
    provider: "openrouter",
    apiKey: "env-key",
    model: "env-audio",
    url: "https://openrouter.ai/api/v1",
    costPerMinute: 0.01,
    directUrl: "https://openrouter.ai/api/v1/audio/transcriptions",
    language: "en",
    directFormat: "json",
    directProvider: "Together",
  },
  embedder: {
    provider: "openai",
    apiKey: "env-emb-key",
    model: "env-embedder",
    url: "https://api.openai.com/v1",
    dimensions: 1536,
    inputCostPer1MTokens: 0.02,
  },
  transcriber: { provider: "openai", apiKey: "env-stt-key", model: "env-transcriber" },
  documentAi: {
    provider: "custom",
    apiKey: "env-doc-key",
    model: "env-ocr",
    url: "https://ocr.example.com",
    costPerPage: 0.03,
  },
  ...over,
});

interface Harness {
  resolver: AiConnectionResolverService;
  repository: { findAllForResolver: ReturnType<typeof vi.fn> };
  encryption: { decrypt: ReturnType<typeof vi.fn>; encrypt: ReturnType<typeof vi.fn>; isConfigured: () => boolean };
  cls: { get: ReturnType<typeof vi.fn>; run: (fn: () => any) => any };
  logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

function makeHarness(params: { connections?: any[]; companyId?: string; aiConfig?: any } = {}): Harness {
  const repository = {
    findAllForResolver: vi.fn(async () => params.connections ?? []),
  };
  const encryption = {
    isConfigured: () => true,
    encrypt: vi.fn((value: string) => enc(value)),
    decrypt: vi.fn((value: string) => {
      const match = /^enc\((.*)\)$/.exec(value);
      if (!match) throw new Error(`cannot decrypt ${value}`);
      return match[1];
    }),
  };
  const cls = {
    get: vi.fn(() => params.companyId),
    run: (fn: () => any) => fn(),
  };
  const logger = { warn: vi.fn(), error: vi.fn() };
  // `in` rather than `??` so a test can deliberately pass `aiConfig: undefined`.
  const aiConfig = "aiConfig" in params ? params.aiConfig : makeAiConfig();
  const configService = { get: (key: string) => (key === "ai" ? aiConfig : undefined) };

  const resolver = new AiConnectionResolverService(
    repository as any,
    encryption as any,
    cls as any,
    configService as any,
    logger as any,
  );

  return { resolver, repository, encryption, cls, logger };
}

// --- tests ----------------------------------------------------------------

describe("AiConnectionResolverService.resolve", () => {
  it("returns only the env candidate when the table is empty (today's behaviour exactly)", async () => {
    const { resolver } = makeHarness({ connections: [] });
    await resolver.refreshNow();

    const candidates = resolver.resolve("ai");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      source: "env",
      connectionId: "env:ai",
      connectionType: "ai",
      provider: "openrouter",
      apiKey: "env-key",
      model: "env-model",
    });
  });

  it("returns the global chain ordered by position with the env candidate appended last", async () => {
    const { resolver } = makeHarness({
      connections: [
        makeConnection({ id: "second", position: 1, model: "model-b" }),
        makeConnection({ id: "first", position: 0, model: "model-a" }),
      ],
    });
    await resolver.refreshNow();

    const candidates = resolver.resolve("ai");

    expect(candidates.map((candidate) => candidate.connectionId)).toEqual(["first", "second", "env:ai"]);
    expect(candidates.map((candidate) => candidate.model)).toEqual(["model-a", "model-b", "env-model"]);
    expect(candidates[0].source).toBe("db");
    expect(candidates[2].source).toBe("env");
  });

  it("does not mix chains of different connection types", async () => {
    const { resolver } = makeHarness({
      connections: [
        makeConnection({ id: "chat", connectionType: "ai" }),
        makeConnection({ id: "emb", connectionType: "embedder", model: "db-embedder" }),
      ],
    });
    await resolver.refreshNow();

    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["chat", "env:ai"]);
    expect(resolver.resolve("embedder").map((c) => c.connectionId)).toEqual(["emb", "env:embedder"]);
  });

  it("replaces the global chain with the per-company chain when the request's company has one", async () => {
    const { resolver } = makeHarness({
      companyId: "company-1",
      connections: [
        makeConnection({ id: "global-a", position: 0 }),
        makeConnection({ id: "company-a", position: 0, companyId: "company-1" }),
        makeConnection({ id: "company-b", position: 1, companyId: "company-1" }),
      ],
    });
    await resolver.refreshNow();

    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["company-a", "company-b", "env:ai"]);
  });

  it("falls back to the global chain when the company has no chain for that type", async () => {
    const { resolver } = makeHarness({
      companyId: "company-2",
      connections: [
        makeConnection({ id: "global-a", position: 0 }),
        makeConnection({ id: "company-a", position: 0, companyId: "company-1" }),
      ],
    });
    await resolver.refreshNow();

    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["global-a", "env:ai"]);
  });

  it("excludes disabled connections from the snapshot", async () => {
    const { resolver } = makeHarness({
      connections: [
        makeConnection({ id: "on", position: 0, enabled: true }),
        makeConnection({ id: "off", position: 1, enabled: false }),
      ],
    });
    await resolver.refreshNow();

    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["on", "env:ai"]);
  });

  it("decrypts stored secrets into the candidate", async () => {
    const { resolver, encryption } = makeHarness({
      connections: [
        makeConnection({
          id: "vertex",
          provider: "vertex",
          apiKey: enc("secret-key"),
          googleCredentialsBase64: enc("secret-creds"),
        }),
      ],
    });
    await resolver.refreshNow();

    const [candidate] = resolver.resolve("ai");
    expect(candidate.apiKey).toBe("secret-key");
    expect(candidate.googleCredentialsBase64).toBe("secret-creds");
    expect(encryption.decrypt).toHaveBeenCalledWith(enc("secret-key"));
  });

  it("skips a connection whose secret cannot be decrypted and keeps the rest of the chain", async () => {
    const { resolver, logger } = makeHarness({
      connections: [
        makeConnection({ id: "broken", position: 0, apiKey: BROKEN_SECRET }),
        makeConnection({ id: "healthy", position: 1 }),
      ],
    });

    await expect(resolver.refreshNow()).resolves.toBeUndefined();

    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["healthy", "env:ai"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("skips a connection whose connectionType is not a known AI connection type", async () => {
    const { resolver, logger } = makeHarness({
      connections: [
        makeConnection({ id: "bogus", position: 0, connectionType: "not-a-type" }),
        makeConnection({ id: "healthy", position: 1 }),
      ],
    });
    await resolver.refreshNow();

    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["healthy", "env:ai"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("never throws when the config is missing entirely", async () => {
    const { resolver } = makeHarness({ connections: [], aiConfig: undefined });
    await resolver.refreshNow();

    const candidates = resolver.resolve("ai");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ source: "env", connectionId: "env:ai", provider: "", apiKey: "" });
  });
});

describe("AiConnectionResolverService env candidate mapping", () => {
  it("maps the embedder block field-for-field, including dimensions", async () => {
    const { resolver } = makeHarness({ connections: [] });
    await resolver.refreshNow();

    expect(resolver.resolve("embedder")[0]).toMatchObject({
      source: "env",
      connectionId: "env:embedder",
      connectionType: "embedder",
      provider: "openai",
      apiKey: "env-emb-key",
      model: "env-embedder",
      dimensions: 1536,
      inputCostPer1MTokens: 0.02,
    });
  });

  it("maps the audio block extras (direct endpoint + per-minute cost)", async () => {
    const { resolver } = makeHarness({ connections: [] });
    await resolver.refreshNow();

    expect(resolver.resolve("audio")[0]).toMatchObject({
      connectionId: "env:audio",
      costPerMinute: 0.01,
      directUrl: "https://openrouter.ai/api/v1/audio/transcriptions",
      language: "en",
      directFormat: "json",
      directProvider: "Together",
    });
  });

  it("maps the documentAi block including costPerPage", async () => {
    const { resolver } = makeHarness({ connections: [] });
    await resolver.refreshNow();

    expect(resolver.resolve("documentAi")[0]).toMatchObject({
      connectionId: "env:documentAi",
      provider: "custom",
      model: "env-ocr",
      costPerPage: 0.03,
    });
  });

  it("resolves each chat tier from its own block", async () => {
    const { resolver } = makeHarness({ connections: [] });
    await resolver.refreshNow();

    expect(resolver.resolve("aiLite")[0].model).toBe("env-lite");
    expect(resolver.resolve("aiLarge")[0].model).toBe("env-large");
    expect(resolver.resolve("vision")[0].model).toBe("env-vision");
    expect(resolver.resolve("transcriber")[0].model).toBe("env-transcriber");
  });
});

describe("AiConnectionResolverService.markFailure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips a failed candidate until the cooldown window elapses", async () => {
    const { resolver } = makeHarness({
      connections: [makeConnection({ id: "first", position: 0 }), makeConnection({ id: "second", position: 1 })],
    });
    await resolver.refreshNow();

    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["first", "second", "env:ai"]);

    resolver.markFailure("first");
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["second", "env:ai"]);

    // Still cooling one minute before the window closes.
    vi.advanceTimersByTime(4 * 60_000);
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["second", "env:ai"]);

    // Back in rotation once the 5-minute window has passed.
    vi.advanceTimersByTime(61_000);
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["first", "second", "env:ai"]);
  });

  it("cools the env candidate down like any other, keyed env:<type>", async () => {
    const { resolver } = makeHarness({ connections: [makeConnection({ id: "first", position: 0 })] });
    await resolver.refreshNow();

    resolver.markFailure("env:ai");
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["first"]);

    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["first", "env:ai"]);
  });

  it("honours a configured cooldown window", async () => {
    const { resolver } = makeHarness({
      connections: [makeConnection({ id: "first", position: 0 })],
      aiConfig: makeAiConfig({ connectionCooldownMinutes: 1 }),
    });
    await resolver.refreshNow();

    resolver.markFailure("first");
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["env:ai"]);

    vi.advanceTimersByTime(60_001);
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["first", "env:ai"]);
  });

  it("defaults the cooldown to 5 minutes when the config knob is absent", async () => {
    const aiConfig = makeAiConfig();
    delete aiConfig.connectionCooldownMinutes;
    const { resolver } = makeHarness({ connections: [makeConnection({ id: "first", position: 0 })], aiConfig });
    await resolver.refreshNow();

    resolver.markFailure("first");
    vi.advanceTimersByTime(4 * 60_000);
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["env:ai"]);

    vi.advanceTimersByTime(61_000);
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["first", "env:ai"]);
  });

  it("fails open: returns the full chain when every candidate is cooling down", async () => {
    const { resolver } = makeHarness({
      connections: [makeConnection({ id: "first", position: 0 }), makeConnection({ id: "second", position: 1 })],
    });
    await resolver.refreshNow();

    resolver.markFailure("first");
    resolver.markFailure("second");
    resolver.markFailure("env:ai");

    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["first", "second", "env:ai"]);
  });

  it("ignores an empty connection id", async () => {
    const { resolver } = makeHarness({ connections: [makeConnection({ id: "first", position: 0 })] });
    await resolver.refreshNow();

    resolver.markFailure("");
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["first", "env:ai"]);
  });
});

describe("AiConnectionResolverService.refreshNow", () => {
  it("keeps the previous snapshot when the repository read fails", async () => {
    const { resolver, repository, logger } = makeHarness({
      connections: [makeConnection({ id: "first", position: 0 })],
    });
    await resolver.refreshNow();
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["first", "env:ai"]);

    repository.findAllForResolver.mockRejectedValueOnce(new Error("neo4j unavailable"));
    await expect(resolver.refreshNow()).resolves.toBeUndefined();

    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["first", "env:ai"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("picks up admin writes on the next refresh", async () => {
    const { resolver, repository } = makeHarness({ connections: [] });
    await resolver.refreshNow();
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["env:ai"]);

    repository.findAllForResolver.mockResolvedValueOnce([makeConnection({ id: "added", position: 0 })]);
    await resolver.refreshNow();

    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["added", "env:ai"]);
  });

  it("reads the repository inside a CLS context", async () => {
    const { resolver, cls } = makeHarness({ connections: [] });
    const runSpy = vi.spyOn(cls, "run");

    await resolver.refreshNow();

    expect(runSpy).toHaveBeenCalledTimes(1);
  });
});

describe("AiConnectionResolverService.onModuleInit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the snapshot and schedules an unref'd 60s refresh", async () => {
    vi.useFakeTimers();
    const { resolver, repository } = makeHarness({ connections: [makeConnection({ id: "first", position: 0 })] });

    resolver.onModuleInit();
    await vi.waitFor(() => expect(repository.findAllForResolver).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(repository.findAllForResolver).toHaveBeenCalledTimes(2);
  });

  it("never rejects when the initial load fails", async () => {
    const { resolver, repository, logger } = makeHarness({ connections: [] });
    repository.findAllForResolver.mockRejectedValueOnce(new Error("boot read failed"));

    expect(() => resolver.onModuleInit()).not.toThrow();
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled());

    // Degrades to the env candidate — never to "no AI".
    expect(resolver.resolve("ai").map((c) => c.connectionId)).toEqual(["env:ai"]);
  });
});
