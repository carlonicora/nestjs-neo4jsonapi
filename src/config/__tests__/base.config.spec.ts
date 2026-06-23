import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBaseConfig } from "../base.config";

describe("createBaseConfig — AI tiers", () => {
  const AI_KEYS = [
    "AI_PROVIDER",
    "AI_API_KEY",
    "AI_MODEL",
    "AI_URL",
    "AI_REGION",
    "AI_SECRET",
    "AI_INSTANCE",
    "AI_API_VERSION",
    "AI_INPUT_COST_PER_1M_TOKENS",
    "AI_OUTPUT_COST_PER_1M_TOKENS",
    "AI_CACHED_INPUT_COST_PER_1M_TOKENS",
    "AI_MAX_OUTPUT_TOKENS",
    "AI_ALLOW_FALLBACKS",
    "AI_GOOGLE_CREDENTIALS_BASE64",
  ];
  const suffixed = (s: string) => AI_KEYS.map((k) => `${k}${s}`);
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [...AI_KEYS, ...suffixed("_LITE"), ...suffixed("_LARGE")]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("defaults aiLite/aiLarge to a deep copy of ai when no suffixed vars are set", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "normal-model";
    process.env.AI_API_KEY = "key-normal";

    const cfg = createBaseConfig().ai;

    expect(cfg.aiLite).toEqual(cfg.ai);
    expect(cfg.aiLarge).toEqual(cfg.ai);
    expect(cfg.ai.model).toBe("normal-model");
  });

  it("overrides only the explicitly-set lite field, inheriting the rest from normal", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "normal-model";
    process.env.AI_API_KEY = "key-normal";
    process.env.AI_MODEL_LITE = "lite-model";

    const cfg = createBaseConfig().ai;

    expect(cfg.aiLite.model).toBe("lite-model");
    expect(cfg.aiLite.provider).toBe("openrouter");
    expect(cfg.aiLite.apiKey).toBe("key-normal");
    expect(cfg.ai.model).toBe("normal-model");
  });

  it("resolves large tier independently from lite", () => {
    process.env.AI_MODEL = "normal-model";
    process.env.AI_MODEL_LARGE = "large-model";
    process.env.AI_INPUT_COST_PER_1M_TOKENS_LARGE = "15";

    const cfg = createBaseConfig().ai;

    expect(cfg.aiLarge.model).toBe("large-model");
    expect(cfg.aiLarge.inputCostPer1MTokens).toBe(15);
    expect(cfg.aiLite.model).toBe("normal-model");
  });

  it("resolves maxOutputTokens per tier, falling back to the base value", () => {
    process.env.AI_MODEL = "normal-model";
    process.env.AI_MAX_OUTPUT_TOKENS = "4096";
    process.env.AI_MAX_OUTPUT_TOKENS_LARGE = "16384";

    const cfg = createBaseConfig().ai;

    expect(cfg.ai.maxOutputTokens).toBe(4096);
    expect(cfg.aiLite.maxOutputTokens).toBe(4096);
    expect(cfg.aiLarge.maxOutputTokens).toBe(16384);
  });

  it("leaves maxOutputTokens undefined when no env var is set", () => {
    process.env.AI_MODEL = "normal-model";

    const cfg = createBaseConfig().ai;

    expect(cfg.ai.maxOutputTokens).toBeUndefined();
    expect(cfg.aiLarge.maxOutputTokens).toBeUndefined();
  });

  it("parses the cached input rate per tier, leaving it undefined when unset", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "normal-model";
    process.env.AI_CACHED_INPUT_COST_PER_1M_TOKENS = "0.03";
    process.env.AI_CACHED_INPUT_COST_PER_1M_TOKENS_LARGE = "0.05";

    const cfg = createBaseConfig().ai;

    expect(cfg.ai.cachedInputCostPer1MTokens).toBe(0.03);
    expect(cfg.aiLite.cachedInputCostPer1MTokens).toBe(0.03); // inherits base
    expect(cfg.aiLarge.cachedInputCostPer1MTokens).toBe(0.05); // own override
  });

  it("leaves cachedInputCostPer1MTokens undefined when the env var is unset", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "normal-model";

    const cfg = createBaseConfig().ai;

    expect(cfg.ai.cachedInputCostPer1MTokens).toBeUndefined();
  });

  it("treats a tier that switches provider as standalone — no field leaks from the base tier", () => {
    process.env.AI_PROVIDER = "ollama";
    process.env.AI_MODEL = "gemma:12b";
    process.env.AI_URL = "http://localhost:11434/v1";
    process.env.AI_API_KEY = "local-key";
    process.env.AI_INPUT_COST_PER_1M_TOKENS = "0.1";
    process.env.AI_OUTPUT_COST_PER_1M_TOKENS = "0.4";

    process.env.AI_PROVIDER_LARGE = "opencode";
    process.env.AI_MODEL_LARGE = "big-model";
    process.env.AI_API_KEY_LARGE = "opencode-key";

    const cfg = createBaseConfig().ai;

    expect(cfg.aiLarge.provider).toBe("opencode");
    expect(cfg.aiLarge.model).toBe("big-model");
    expect(cfg.aiLarge.apiKey).toBe("opencode-key");
    // The base tier's ollama URL must NOT leak into the opencode tier.
    expect(cfg.aiLarge.url).toBe("");
    expect(cfg.aiLarge.inputCostPer1MTokens).toBe(0);
    expect(cfg.aiLarge.outputCostPer1MTokens).toBe(0);
    // Base tier untouched.
    expect(cfg.ai.provider).toBe("ollama");
    expect(cfg.ai.url).toBe("http://localhost:11434/v1");
  });

  it("keeps field-by-field inheritance when the tier re-declares the SAME provider", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "normal-model";
    process.env.AI_URL = "https://openrouter.ai/api/v1";
    process.env.AI_API_KEY = "shared-key";

    process.env.AI_PROVIDER_LITE = "openrouter";
    process.env.AI_MODEL_LITE = "lite-model";

    const cfg = createBaseConfig().ai;

    expect(cfg.aiLite.model).toBe("lite-model");
    expect(cfg.aiLite.url).toBe("https://openrouter.ai/api/v1");
    expect(cfg.aiLite.apiKey).toBe("shared-key");
  });

  it("defaults allowFallbacks to true and resolves it per tier from an explicit 'false'", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "normal-model";
    process.env.AI_API_KEY = "key";
    process.env.AI_ALLOW_FALLBACKS_LARGE = "false";

    const cfg = createBaseConfig().ai;

    expect(cfg.ai.allowFallbacks).toBe(true);
    expect(cfg.aiLite.allowFallbacks).toBe(true);
    expect(cfg.aiLarge.allowFallbacks).toBe(false);
  });

  it("does NOT inherit the base AI_REGION into tiers that override only the model", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "normal-model";
    process.env.AI_REGION = "friendli";
    process.env.AI_MODEL_LITE = "lite-model";

    const cfg = createBaseConfig().ai;

    // Base tier keeps its pin; lite must not drag friendli onto a model the
    // provider may not serve there (would 404/422).
    expect(cfg.ai.region).toBe("friendli");
    expect(cfg.aiLite.region).toBe("");
    expect(cfg.aiLarge.region).toBe("");
  });

  it("resolves AI_REGION per tier when set explicitly", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "normal-model";
    process.env.AI_REGION = "friendli";
    process.env.AI_REGION_LARGE = "together";

    const cfg = createBaseConfig().ai;

    expect(cfg.ai.region).toBe("friendli");
    expect(cfg.aiLite.region).toBe("");
    expect(cfg.aiLarge.region).toBe("together");
  });

  it("does NOT inherit a base AI_ALLOW_FALLBACKS=false pin into the other tiers", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "normal-model";
    process.env.AI_ALLOW_FALLBACKS = "false";

    const cfg = createBaseConfig().ai;

    expect(cfg.ai.allowFallbacks).toBe(false);
    expect(cfg.aiLite.allowFallbacks).toBe(true);
    expect(cfg.aiLarge.allowFallbacks).toBe(true);
  });
});
