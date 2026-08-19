import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
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

describe("createBaseConfig — chunker", () => {
  const KEYS = ["CHUNKER_STRATEGY", "OCR_LANGUAGE", "CHUNKER_TARGET_CHARS"];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
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

  it("defaults to markdown-structural / eng / 1500", () => {
    const c = createBaseConfig().chunker;
    expect(c.strategy).toBe("markdown-structural");
    expect(c.ocrLanguage).toBe("eng");
    expect(c.targetChars).toBe(1500);
  });

  it("reads CHUNKER_STRATEGY, OCR_LANGUAGE, CHUNKER_TARGET_CHARS from env", () => {
    process.env.CHUNKER_STRATEGY = "semantic";
    process.env.OCR_LANGUAGE = "ita";
    process.env.CHUNKER_TARGET_CHARS = "3000";
    const c = createBaseConfig().chunker;
    expect(c.strategy).toBe("semantic");
    expect(c.ocrLanguage).toBe("ita");
    expect(c.targetChars).toBe(3000);
  });
});

/**
 * Coverage for the variables that moved into this file when the direct
 * `process.env` reads were removed from the services that used to own them.
 * The services now only surface what config resolved, so the env mapping and
 * its defaults are asserted here.
 */
describe("createBaseConfig — env reads centralised from services", () => {
  const KEYS = [
    "npm_package_version",
    "APP_MODE",
    "NODE_ENV",
    "CACHE_VERSION",
    "LOG_LEVEL",
    "CONSOLE_ENABLED",
    "DEBUG_LOGGING_ENABLED",
    "DEBUG_LOG_PATH",
    "AI_URL_ALLOWLIST",
    "ASSISTANT_DUMP_LLM_CALLS",
    "ASSISTANT_DUMP_LLM_CALLS_DIR",
    "ASSISTANT_DUMP_LLM_REDACT",
    "ASSISTANT_DUMP_LLM_KEEP_FIELDS",
    "MODEL_CONFIG_PATH",
    "MODELS_CACHE_DIR",
    "MODEL_BASE_URL",
    "MODEL_VERIFY_HASH",
    "MODEL_STRICT_HASH",
    "MODEL_AUTO_UPDATE",
    "ONNX_INTRA_OP_NUM_THREADS",
    "ONNX_INTER_OP_NUM_THREADS",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
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

  describe("api.version", () => {
    it("reads npm_package_version", () => {
      process.env.npm_package_version = "2.5.10";
      expect(createBaseConfig().api.version).toBe("2.5.10");
    });

    it("falls back to 1.0.0 when unset or empty", () => {
      expect(createBaseConfig().api.version).toBe("1.0.0");
      process.env.npm_package_version = "";
      expect(createBaseConfig().api.version).toBe("1.0.0");
    });

    it("passes a semantic-version string through untouched", () => {
      process.env.npm_package_version = "1.2.3-alpha.1";
      expect(createBaseConfig().api.version).toBe("1.2.3-alpha.1");
    });
  });

  describe("environment", () => {
    it("defaults appMode to api and only 'worker' flips it", () => {
      expect(createBaseConfig().environment.appMode).toBe("api");
      process.env.APP_MODE = "anything-else";
      expect(createBaseConfig().environment.appMode).toBe("api");
      process.env.APP_MODE = "worker";
      expect(createBaseConfig().environment.appMode).toBe("worker");
    });

    it("exposes NODE_ENV as an empty string when unset", () => {
      expect(createBaseConfig().environment.nodeEnv).toBe("");
      process.env.NODE_ENV = "production";
      expect(createBaseConfig().environment.nodeEnv).toBe("production");
    });
  });

  describe("cache.version", () => {
    it("defaults to v1 and reads CACHE_VERSION", () => {
      expect(createBaseConfig().cache.version).toBe("v1");
      process.env.CACHE_VERSION = "v2";
      expect(createBaseConfig().cache.version).toBe("v2");
    });
  });

  describe("logging", () => {
    it("leaves level empty when unset so each transport applies its own default", () => {
      expect(createBaseConfig().logging.level).toBe("");
      process.env.LOG_LEVEL = "warn";
      expect(createBaseConfig().logging.level).toBe("warn");
    });

    it("keeps console output off unless CONSOLE_ENABLED is exactly 'true'", () => {
      expect(createBaseConfig().logging.consoleEnabled).toBe(false);
      process.env.CONSOLE_ENABLED = "1";
      expect(createBaseConfig().logging.consoleEnabled).toBe(false);
      process.env.CONSOLE_ENABLED = "true";
      expect(createBaseConfig().logging.consoleEnabled).toBe(true);
    });

    it("reads the debug round-logger switches", () => {
      const off = createBaseConfig().logging.debug;
      expect(off.enabled).toBe(false);
      expect(off.basePath).toBe("./logs");

      process.env.DEBUG_LOGGING_ENABLED = "true";
      process.env.DEBUG_LOG_PATH = "./test-logs";
      const on = createBaseConfig().logging.debug;
      expect(on.enabled).toBe(true);
      expect(on.basePath).toBe("./test-logs");
    });
  });

  describe("ai.urlAllowlist", () => {
    it("is undefined when unset, so no allowlist check runs", () => {
      expect(createBaseConfig().ai.urlAllowlist).toBeUndefined();
      process.env.AI_URL_ALLOWLIST = "";
      expect(createBaseConfig().ai.urlAllowlist).toBeUndefined();
    });

    it("splits, trims and drops empty entries", () => {
      process.env.AI_URL_ALLOWLIST = " api.example.com , openrouter.ai ,, ";
      expect(createBaseConfig().ai.urlAllowlist).toEqual(["api.example.com", "openrouter.ai"]);
    });

    it("keeps an empty ARRAY distinct from undefined when the value lists no host", () => {
      // A set-but-unusable value must reject every URL rather than silently
      // disabling the check.
      process.env.AI_URL_ALLOWLIST = ",";
      expect(createBaseConfig().ai.urlAllowlist).toEqual([]);
    });
  });

  describe("ai.dump", () => {
    it("is off unless ASSISTANT_DUMP_LLM_CALLS is exactly '1'", () => {
      expect(createBaseConfig().ai.dump.enabled).toBe(false);
      process.env.ASSISTANT_DUMP_LLM_CALLS = "true";
      expect(createBaseConfig().ai.dump.enabled).toBe(false);
      process.env.ASSISTANT_DUMP_LLM_CALLS = "1";
      expect(createBaseConfig().ai.dump.enabled).toBe(true);
    });

    it("defaults the output dir to <cwd>/.llm-dumps", () => {
      expect(createBaseConfig().ai.dump.dir).toBe(`${process.cwd()}/.llm-dumps`);
      process.env.ASSISTANT_DUMP_LLM_CALLS_DIR = "/tmp/dumps";
      expect(createBaseConfig().ai.dump.dir).toBe("/tmp/dumps");
    });

    it("defaults redaction off and parses the keep-list", () => {
      const off = createBaseConfig().ai.dump;
      expect(off.redact).toBe(false);
      expect(off.keepFields).toEqual([]);

      process.env.ASSISTANT_DUMP_LLM_REDACT = "true";
      process.env.ASSISTANT_DUMP_LLM_KEEP_FIELDS = "metadata.gameId, metadata.roundId ,";
      const on = createBaseConfig().ai.dump;
      expect(on.redact).toBe(true);
      expect(on.keepFields).toEqual(["metadata.gameId", "metadata.roundId"]);
    });
  });

  describe("modelManager", () => {
    it("defaults every path, host and switch", () => {
      const m = createBaseConfig().modelManager;
      expect(m.configPath).toBe(path.join(process.cwd(), "config", "models.config.yaml"));
      expect(m.cacheDir).toBe(path.join(process.cwd(), ".cache", "models"));
      expect(m.baseUrl).toBe("https://huggingface.co");
      expect(m.verifyHash).toBe(true);
      expect(m.strictHash).toBe(true);
      expect(m.autoUpdate).toBe(true);
      expect(m.onnx).toEqual({ intraOpNumThreads: 2, interOpNumThreads: 1 });
    });

    it("reads every override, and only the literal 'false' disables a switch", () => {
      process.env.MODEL_CONFIG_PATH = "/etc/models.yaml";
      process.env.MODELS_CACHE_DIR = "/var/cache/models";
      process.env.MODEL_BASE_URL = "https://mirror.example.com";
      process.env.MODEL_VERIFY_HASH = "false";
      process.env.MODEL_STRICT_HASH = "0";
      process.env.MODEL_AUTO_UPDATE = "false";
      process.env.ONNX_INTRA_OP_NUM_THREADS = "8";
      process.env.ONNX_INTER_OP_NUM_THREADS = "4";

      const m = createBaseConfig().modelManager;
      expect(m.configPath).toBe("/etc/models.yaml");
      expect(m.cacheDir).toBe("/var/cache/models");
      expect(m.baseUrl).toBe("https://mirror.example.com");
      expect(m.verifyHash).toBe(false);
      // "0" is not "false", so the switch stays on — the documented semantics.
      expect(m.strictHash).toBe(true);
      expect(m.autoUpdate).toBe(false);
      expect(m.onnx).toEqual({ intraOpNumThreads: 8, interOpNumThreads: 4 });
    });
  });
});
