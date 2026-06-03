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
});
