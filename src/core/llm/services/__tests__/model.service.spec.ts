import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// --- Module mocks ---------------------------------------------------------
// `model.service.ts` uses `import * as fs from "fs"` and `import * as crypto
// from "crypto"`. ESM namespace exports cannot be spied with `vi.spyOn`, so we
// mock the whole modules. We keep `os`/`path` real so the produced temp path is
// realistic, and only stub the file write + UUID generation.
const fsMock = vi.hoisted(() => ({ writeFileSync: vi.fn(), unlinkSync: vi.fn() }));
const cryptoMock = vi.hoisted(() => ({ randomUUID: vi.fn(() => "00000000-0000-0000-0000-000000000000") }));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, writeFileSync: fsMock.writeFileSync, unlinkSync: fsMock.unlinkSync };
});

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return { ...actual, randomUUID: cryptoMock.randomUUID };
});

// Stub the Vertex SDK so the env-restore contract test does not depend on real
// Google credentials/libraries at construction time.
vi.mock("@langchain/google-vertexai", () => ({
  ChatVertexAI: class {
    constructor(public readonly opts: any) {}
  },
  VertexAIEmbeddings: class {
    constructor(public readonly opts: any) {}
  },
}));

import {
  ModelService,
  supportsGeminiThinkingLevel,
  toGeminiThinkingLevel,
  validateAiUrl,
  writeGcpCredentials,
} from "../model.service";
import { ModelWeight } from "../../enums/model.weight";
import { ChatOpenAIResponses } from "@langchain/openai";

function makeService(aiConfig: any): ModelService {
  const configService = { get: (_k: string) => aiConfig } as any;
  const clsService = { get: () => undefined } as any;
  return new ModelService(clsService, configService);
}

/**
 * Same harness plus the (optional) AI-connection resolver. Positional gap =
 * the equally optional bucket / logger, which these tests do not need.
 */
function makeServiceWithResolver(aiConfig: any, resolver: any): ModelService {
  const configService = { get: (_k: string) => aiConfig } as any;
  const clsService = { get: () => undefined } as any;
  return new ModelService(clsService, configService, undefined, undefined, resolver);
}

/** A resolver double: chains keyed by connection type. */
function stubResolver(chains: Record<string, any[]>) {
  return {
    resolve: vi.fn((type: string) => chains[type] ?? []),
    markFailure: vi.fn(),
  };
}

/** A DB-sourced candidate, openrouter-shaped unless overridden. */
const dbCandidate = (over: Partial<any> = {}): any => ({
  source: "db",
  connectionId: "conn-1",
  connectionType: "ai",
  provider: "openrouter",
  apiKey: "db-key",
  model: "db-model",
  url: "https://primary.example.com/v1",
  ...over,
});

const tier = (over: Partial<any> = {}) => ({
  provider: "openrouter",
  apiKey: "k",
  model: "normal",
  url: "https://x/v1",
  inputCostPer1MTokens: 0,
  outputCostPer1MTokens: 0,
  ...over,
});

describe("ModelService.getResolvedConfig", () => {
  let svc: ModelService;
  beforeEach(() => {
    svc = makeService({
      ai: tier({ model: "normal" }),
      aiLite: tier({ model: "lite" }),
      aiLarge: tier({ model: "large" }),
    });
  });

  it("returns the normal block by default", () => {
    expect(svc.getResolvedConfig().model).toBe("normal");
    expect(svc.getResolvedConfig(ModelWeight.Normal).model).toBe("normal");
  });

  it("returns the lite block for Lite", () => {
    expect(svc.getResolvedConfig(ModelWeight.Lite).model).toBe("lite");
  });

  it("returns the large block for Large", () => {
    expect(svc.getResolvedConfig(ModelWeight.Large).model).toBe("large");
  });
});

describe("ModelService.getLLM tier selection", () => {
  it("builds the LLM from the weight-selected block (openrouter → ChatOpenAI)", () => {
    const svc = makeService({
      ai: tier({ model: "normal" }),
      aiLite: tier({ model: "lite" }),
      aiLarge: tier({ model: "large" }),
    });
    const llm = svc.getLLM({ modelWeight: ModelWeight.Lite }) as any;
    expect(llm.model ?? llm.modelName).toBe("lite");
  });
});

describe("ModelService.getLLM generic OpenAI-compatible providers", () => {
  it("builds a ChatOpenAI against the configured URL for an unlisted provider (e.g. opencode)", () => {
    const svc = makeService({
      ai: tier({ provider: "opencode", model: "big-model", url: "https://opencode.ai/zen/v1", apiKey: "zen-key" }),
      aiLite: tier(),
      aiLarge: tier(),
    });
    const llm = svc.getLLM() as any;
    expect(llm.model ?? llm.modelName).toBe("big-model");
    expect(llm.clientConfig?.baseURL ?? llm.configuration?.baseURL).toBe("https://opencode.ai/zen/v1");
  });

  it("throws a configuration error for an unlisted provider without a URL", () => {
    const svc = makeService({
      ai: tier({ provider: "opencode", model: "big-model", url: "", apiKey: "zen-key" }),
      aiLite: tier(),
      aiLarge: tier(),
    });
    expect(() => svc.getLLM()).toThrow(/opencode/);
  });

  it("applies the tier's maxOutputTokens from config", () => {
    const svc = makeService({
      ai: tier({ model: "normal", maxOutputTokens: 2048 }),
      aiLite: tier(),
      aiLarge: tier(),
    });
    const llm = svc.getLLM() as any;
    expect(llm.maxTokens).toBe(2048);
  });
});

describe("ModelService.getLLM openrouter escalating pin", () => {
  /** Sends one request through the fetch the service installed, and returns the
   *  body that actually reached the wire. */
  async function bodySentBy(llm: any): Promise<any> {
    const fetchFn = llm.clientConfig?.fetch ?? llm.configuration?.fetch;
    expect(typeof fetchFn).toBe("function");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    try {
      await fetchFn("https://x/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "m" }) });
      return JSON.parse((spy.mock.calls[0][1] as any).body);
    } finally {
      spy.mockRestore();
    }
  }

  it("pins the provider through the installed fetch when a region is set (no static modelKwargs.provider)", async () => {
    const svc = makeService({
      ai: tier({ provider: "openrouter", region: "together", allowFallbacks: false }),
      aiLite: tier(),
      aiLarge: tier(),
    });
    const llm = svc.getLLM() as any;
    // The pin survives being wrapped by the unsupported-parameter middleware.
    expect((await bodySentBy(llm)).provider).toEqual({
      order: ["together"],
      allow_fallbacks: false,
      require_parameters: true,
    });
    // The provider routing is injected by the fetch middleware, not via modelKwargs.
    expect(llm.modelKwargs?.provider).toBeUndefined();
  });

  it("does not pin the provider when no region is configured", async () => {
    const svc = makeService({
      ai: tier({ provider: "openrouter", region: undefined }),
      aiLite: tier(),
      aiLarge: tier(),
    });
    // A fetch is ALWAYS installed now (the unsupported-parameter repair
    // middleware); what must not happen without a region is the routing pin.
    expect((await bodySentBy(svc.getLLM() as any)).provider).toBeUndefined();
  });
});

// === TASK 4: validateAiUrl ================================================
describe("validateAiUrl", () => {
  const ENV_KEY = "AI_URL_ALLOWLIST";
  let savedAllowlist: string | undefined;

  beforeEach(() => {
    savedAllowlist = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedAllowlist === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedAllowlist;
  });

  it("accepts an https url", () => {
    expect(() => validateAiUrl("https://api.example.com/v1", "openrouter")).not.toThrow();
  });

  it("accepts http://localhost", () => {
    expect(() => validateAiUrl("http://localhost:8033/v1", "llamacpp")).not.toThrow();
  });

  it("accepts http://127.0.0.1", () => {
    expect(() => validateAiUrl("http://127.0.0.1:11434/v1", "ollama")).not.toThrow();
  });

  it("accepts an http://*.local host", () => {
    expect(() => validateAiUrl("http://mybox.local:8080/v1", "local")).not.toThrow();
  });

  it("rejects http to a public host (HTTPS required)", () => {
    expect(() => validateAiUrl("http://api.example.com/v1", "openrouter")).toThrow(/HTTPS/);
  });

  it("rejects a malformed url", () => {
    expect(() => validateAiUrl("not a url", "openrouter")).toThrow(/valid URL/);
  });

  it("rejects an empty url", () => {
    expect(() => validateAiUrl("", "openrouter")).toThrow(/AI_URL/);
  });

  describe("AI_URL_ALLOWLIST enforcement", () => {
    it("allows a host that is exactly listed", () => {
      process.env[ENV_KEY] = "api.example.com,openrouter.ai";
      expect(() => validateAiUrl("https://api.example.com/v1", "openrouter")).not.toThrow();
    });

    it("allows a subdomain of a listed host", () => {
      process.env[ENV_KEY] = "example.com";
      expect(() => validateAiUrl("https://api.example.com/v1", "openrouter")).not.toThrow();
    });

    it("rejects a host that is not in the allowlist", () => {
      process.env[ENV_KEY] = "example.com";
      expect(() => validateAiUrl("https://evil.com/v1", "openrouter")).toThrow(/allowlist/);
    });
  });
});

// === TASK 2: writeGcpCredentials =========================================
describe("writeGcpCredentials", () => {
  beforeEach(() => {
    fsMock.writeFileSync.mockClear();
    cryptoMock.randomUUID.mockReset();
    cryptoMock.randomUUID.mockReturnValue("11111111-1111-1111-1111-111111111111");
  });

  it("writes to a UUID-unique path matching gcp-creds-<tag>-<uuid>.json", () => {
    const p = writeGcpCredentials(Buffer.from("hello").toString("base64"), "llm");
    expect(p).toMatch(/gcp-creds-llm-.*\.json$/);
  });

  it("produces different paths on two calls", () => {
    const uuids = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"];
    let i = 0;
    cryptoMock.randomUUID.mockImplementation(() => uuids[i++]);
    const p1 = writeGcpCredentials("Zm9v", "llm");
    const p2 = writeGcpCredentials("Zm9v", "llm");
    expect(p1).not.toBe(p2);
  });

  it("writes with mode 0o600", () => {
    writeGcpCredentials(Buffer.from("secret").toString("base64"), "embedder");
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(expect.any(String), expect.anything(), { mode: 0o600 });
  });
});

// === TASK 2: vertex credentials env contract =============================
describe("ModelService vertex credentials env contract", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    fsMock.writeFileSync.mockClear();
    cryptoMock.randomUUID.mockReturnValue("22222222-2222-2222-2222-222222222222");
    savedEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = savedEnv;
  });

  it("sets GOOGLE_APPLICATION_CREDENTIALS to the written creds file and LEAVES it set after building a vertex model", () => {
    const svc = makeService({
      ai: tier({
        provider: "vertex",
        model: "gemini-2.5-flash",
        region: "us-central1",
        googleCredentialsBase64: Buffer.from("{}").toString("base64"),
      }),
      aiLite: tier(),
      aiLarge: tier(),
    });
    // GoogleAuth resolves the project id LAZILY on the first request, so the env
    // var must remain set after construction — matching the app-local behaviour.
    svc.getLLM();
    expect(fsMock.writeFileSync).toHaveBeenCalled();
    expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBeDefined();
  });

  const vertexSvc = (region: string) =>
    makeService({
      ai: tier({ provider: "vertex", model: "gemini-2.5-flash", region }),
      aiLite: tier(),
      aiLarge: tier(),
    });

  it("routes a multi-region location through the .rep. endpoint", () => {
    // Without this, LangChain builds "eu-aiplatform.googleapis.com" — not a
    // Vertex endpoint (404). See utils/vertex.utils.ts.
    const llm = vertexSvc("eu").getLLM() as any;
    expect(llm.opts.location).toBe("eu");
    expect(llm.opts.endpoint).toBe("aiplatform.eu.rep.googleapis.com");
  });

  it("leaves a regional location on LangChain's computed endpoint", () => {
    const llm = vertexSvc("europe-west4").getLLM() as any;
    expect(llm.opts.location).toBe("europe-west4");
    expect(llm.opts.endpoint).toBeUndefined();
  });
});

/**
 * Reasoning effort has to reach Vertex as `thinkingLevel`.
 *
 * `llmConfig.modelKwargs` — where `reasoning_effort` is resolved for the
 * OpenAI-compatible clients — never reaches the vertex branch, which returns its
 * own client. A configured `AI_REASONING_EFFORT` was therefore dropped in
 * silence: a cost-test run pinned at `low` was really measured at the model's
 * default, and nothing in any log said so.
 */
describe("ModelService vertex thinking level", () => {
  const vertexWith = (over: any) =>
    makeService({ ai: tier({ provider: "vertex", region: "eu", ...over }), aiLite: tier(), aiLarge: tier() });

  it("sends thinkingLevel for a Gemini 3 model with a configured effort", () => {
    const llm = vertexWith({ model: "gemini-3.1-flash-lite", reasoningEffort: "low" }).getLLM() as any;
    expect(llm.opts.thinkingLevel).toBe("LOW");
  });

  it("maps none to MINIMAL — Gemini 3 has no zero thinking level", () => {
    const llm = vertexWith({ model: "gemini-3.1-flash-lite", reasoningEffort: "none" }).getLLM() as any;
    expect(llm.opts.thinkingLevel).toBe("MINIMAL");
  });

  it("NEVER sends thinkingLevel to a pre-Gemini-3 model, even with an effort configured", () => {
    // Sending it to gemini-2.5-* is a hard ERROR, not a no-op. This is the guard
    // that keeps the existing 2.5 tier working when an effort is set.
    const llm = vertexWith({ model: "gemini-2.5-flash-lite", reasoningEffort: "low" }).getLLM() as any;
    expect(llm.opts.thinkingLevel).toBeUndefined();
  });

  it("sends nothing when no effort is configured, so the request is byte-identical to before", () => {
    const llm = vertexWith({ model: "gemini-3.1-flash-lite" }).getLLM() as any;
    expect(llm.opts.thinkingLevel).toBeUndefined();
  });

  it("never passes reasoningEffort to the Vertex client — that maps to a token BUDGET, which Gemini 3 rejects alongside a level", () => {
    const llm = vertexWith({ model: "gemini-3.1-flash-lite", reasoningEffort: "high" }).getLLM() as any;
    expect(llm.opts.thinkingLevel).toBe("HIGH");
    expect(llm.opts.reasoningEffort).toBeUndefined();
    expect(llm.opts.maxReasoningTokens).toBeUndefined();
    expect(llm.opts.thinkingBudget).toBeUndefined();
  });

  it("detects the Gemini major version rather than the literal string gemini-3", () => {
    for (const model of ["gemini-3-pro", "gemini-3.1-flash-lite", "gemini-4-flash", "google/gemini-3.1-flash-lite"]) {
      expect(supportsGeminiThinkingLevel(model)).toBe(true);
    }
    for (const model of ["gemini-2.5-flash-lite", "gemini-1.5-pro", "gpt-5-nano", "", undefined]) {
      expect(supportsGeminiThinkingLevel(model)).toBe(false);
    }
  });

  it("maps every effort onto Gemini's vocabulary", () => {
    expect(toGeminiThinkingLevel("none")).toBe("MINIMAL");
    expect(toGeminiThinkingLevel("minimal")).toBe("MINIMAL");
    expect(toGeminiThinkingLevel("low")).toBe("LOW");
    expect(toGeminiThinkingLevel("medium")).toBe("MEDIUM");
    expect(toGeminiThinkingLevel("high")).toBe("HIGH");
  });
});

// === TASK 1: reasoning effort + strict structured-output capability ======
describe("ModelService reasoning effort", () => {
  const svcWith = (over: any = {}) =>
    makeService({ ai: tier({ provider: "openrouter", model: "m", ...over }), aiLite: tier(), aiLarge: tier() });

  it("sends nothing when neither the call nor the tier asks for an effort", () => {
    const llm = svcWith().getLLM() as any;
    expect(llm.modelKwargs?.reasoning_effort).toBeUndefined();
  });

  it("uses the tier default when the call does not specify", () => {
    const llm = svcWith({ reasoningEffort: "low" }).getLLM() as any;
    expect(llm.modelKwargs?.reasoning_effort).toBe("low");
  });

  it("lets the per-call value win over the tier default", () => {
    const llm = svcWith({ reasoningEffort: "low" }).getLLM({ reasoningEffort: "high" }) as any;
    expect(llm.modelKwargs?.reasoning_effort).toBe("high");
  });

  it("lets a per-call disableThinking win over a tier default (per-call beats config)", () => {
    const llm = svcWith({ reasoningEffort: "low" }).getLLM({ disableThinking: true }) as any;
    expect(llm.modelKwargs?.reasoning_effort).toBe("none");
  });

  it("keeps disableThinking working as an alias for none", () => {
    const llm = svcWith().getLLM({ disableThinking: true }) as any;
    expect(llm.modelKwargs?.reasoning_effort).toBe("none");
  });

  it("lets an explicit reasoningEffort override disableThinking", () => {
    const llm = svcWith().getLLM({ disableThinking: true, reasoningEffort: "medium" }) as any;
    expect(llm.modelKwargs?.reasoning_effort).toBe("medium");
  });

  it("ignores an unrecognised configured effort instead of putting it on the wire", () => {
    // `AI_REASONING_EFFORT` arrives as a free-form string, so a typo would otherwise
    // be cast straight through — costing a 400 the fetch middleware then remembers.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = svcWith({ reasoningEffort: "lwo" }).getLLM() as any;

    expect(llm.modelKwargs?.reasoning_effort).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unrecognised reasoning effort"));
    warn.mockRestore();
  });

  it("does not warn when the tier simply has no configured effort", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    svcWith().getLLM();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still honours a per-call effort when the tier default is unrecognised", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const llm = svcWith({ reasoningEffort: "lwo" }).getLLM({ reasoningEffort: "low" }) as any;
    expect(llm.modelKwargs?.reasoning_effort).toBe("low");
    // The per-call value short-circuits the `??` chain, so the bad config is never read.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("ModelService reasoning effort reaches EVERY provider branch", () => {
  // Regression: the effort used to be spread into the generic `new ChatOpenAI({...})`
  // at the bottom of buildChatModel, which the `azure` branch never reaches because it
  // returns early. `reasoningEffort` was therefore silently dropped on Azure — the one
  // provider this project runs — while every test here passed, because they all built
  // an `openrouter` tier. Assert each branch explicitly.
  //
  // The azure branch is asserted separately, below, because it now speaks the
  // Responses API (`reasoning.effort`, not `modelKwargs.reasoning_effort`) — see
  // "ModelService azure branch speaks the Responses API".
  const providers = [
    { provider: "openrouter", url: "https://openrouter.ai/api/v1" },
    { provider: "ollama", url: "http://localhost:11434/v1" },
    { provider: "llamacpp", url: "http://localhost:8033/v1" },
    { provider: "openai", url: "https://api.openai.com/v1" },
  ];

  for (const over of providers) {
    it(`sends reasoning_effort on the "${over.provider}" branch`, () => {
      const svc = makeService({ ai: tier(over), aiLite: tier(), aiLarge: tier() });
      const llm = svc.getLLM({ reasoningEffort: "low" }) as any;
      expect(llm.modelKwargs?.reasoning_effort).toBe("low");
    });

    it(`sends nothing on the "${over.provider}" branch when no effort is asked for`, () => {
      const svc = makeService({ ai: tier(over), aiLite: tier(), aiLarge: tier() });
      const llm = svc.getLLM() as any;
      expect(llm.modelKwargs?.reasoning_effort).toBeUndefined();
    });
  }
});

describe("ModelService azure branch speaks the Responses API", () => {
  // Azure rejects tools + reasoning_effort on chat/completions for gpt-5.6-luna
  // ("Please use /v1/responses instead"), so the whole branch was moved to the
  // GA v1 Responses surface — see docs/superpowers/specs/2026-08-18-azure-responses-api-design.md.
  const azureTier = (over: any = {}) =>
    tier({ provider: "azure", instance: "inst", apiVersion: "2024-12-01-preview", model: "gpt-5.6-luna", ...over });
  const svcWith = (over: any = {}) => makeService({ ai: azureTier(over), aiLite: tier(), aiLarge: tier() });

  it("builds a ChatOpenAIResponses against the v1 surface derived from the instance", () => {
    const llm = svcWith().getLLM() as any;

    expect(llm).toBeInstanceOf(ChatOpenAIResponses);
    expect(llm.clientConfig.baseURL).toBe("https://inst.openai.azure.com/openai/v1");
  });

  it("never puts the api-version on the client — the v1 surface has none", () => {
    const llm = svcWith().getLLM() as any;
    expect(llm.azureOpenAIApiVersion).toBeUndefined();
    expect(llm.clientConfig.baseURL).not.toContain("api-version");
  });

  it("throws when azure has no instance configured — the v1 baseURL is built from it", () => {
    // The old AzureChatOpenAI construction threw on a missing instance
    // (azureOpenAIApiInstanceName); this branch must not regress to a silent
    // `https://undefined.openai.azure.com/...` ENOTFOUND.
    const svc = svcWith({ instance: undefined });
    expect(() => svc.getLLM()).toThrow(
      "Azure provider requires AI_INSTANCE (or the tier's instance): the v1 baseURL is built from it",
    );
  });

  it("carries a per-call effort as reasoning.effort, NOT modelKwargs.reasoning_effort", () => {
    const llm = svcWith().getLLM({ reasoningEffort: "low" }) as any;

    expect(llm.reasoning).toEqual({ effort: "low" });
    // ChatOpenAIResponses spreads modelKwargs into the request body verbatim —
    // a leaked reasoning_effort would be an unknown Responses parameter.
    expect(llm.modelKwargs?.reasoning_effort).toBeUndefined();
  });

  it("spells disableThinking as reasoning.effort none", () => {
    const llm = svcWith().getLLM({ disableThinking: true }) as any;
    expect(llm.reasoning).toEqual({ effort: "none" });
  });

  it("sends no reasoning object when no effort is asked for", () => {
    const llm = svcWith().getLLM() as any;
    expect(llm.reasoning).toBeUndefined();
  });

  it("opts out of server-side response storage (zdrEnabled → store:false)", () => {
    // Responses is stateful by default with 30-day retention — wrong for
    // legal-domain traffic. zdrEnabled makes LangChain send store:false.
    const llm = svcWith().getLLM() as any;
    expect(llm.zdrEnabled).toBe(true);
  });

  it("hands the vision tier's config-sourced effort to reasoning.effort", () => {
    // getVisionLLM resolves its effort into opts.modelKwargs.reasoning_effort
    // (model.service.ts:713-721) — the azure branch must lift it out, or the
    // vision effort regresses silently.
    const svc = makeService({
      ai: tier(),
      aiLite: tier(),
      aiLarge: tier(),
      vision: tier({ provider: "azure", instance: "inst", model: "gpt-5-nano", reasoningEffort: "low" }),
    });
    const llm = svc.getVisionLLM() as any;

    expect(llm).toBeInstanceOf(ChatOpenAIResponses);
    expect(llm.reasoning).toEqual({ effort: "low" });
    expect(llm.modelKwargs?.reasoning_effort).toBeUndefined();
  });

  it("still keys the client cache on the resolved effort", () => {
    const svc = svcWith();
    expect(svc.getLLM({ reasoningEffort: "low" })).not.toBe(svc.getLLM({ reasoningEffort: "high" }));
    expect(svc.getLLM({ reasoningEffort: "low" })).toBe(svc.getLLM({ reasoningEffort: "low" }));
  });
});

describe("ModelService.supportsStrictStructuredOutput", () => {
  it("is true for OpenAI-compatible providers", () => {
    for (const provider of ["azure", "openrouter", "ollama", "llamacpp", "requesty", "openai"]) {
      const svc = makeService({ ai: tier({ provider }), aiLite: tier(), aiLarge: tier() });
      expect(svc.supportsStrictStructuredOutput()).toBe(true);
    }
  });

  it("is false for vertex, which ignores the strict flag entirely", () => {
    const svc = makeService({ ai: tier({ provider: "vertex" }), aiLite: tier(), aiLarge: tier() });
    expect(svc.supportsStrictStructuredOutput()).toBe(false);
  });

  it("resolves per weight, so a vertex lite tier is reported independently", () => {
    const svc = makeService({ ai: tier({ provider: "azure" }), aiLite: tier({ provider: "vertex" }), aiLarge: tier() });
    expect(svc.supportsStrictStructuredOutput()).toBe(true);
    expect(svc.supportsStrictStructuredOutput(ModelWeight.Lite)).toBe(false);
  });
});

// === LLM client cache =====================================================
describe("ModelService.getLLM client cache", () => {
  const svcWith = (over: any = {}) => makeService({ ai: tier(over), aiLite: tier(), aiLarge: tier() });

  it("returns the SAME instance for identical parameters", () => {
    // getLLM used to build a fresh ChatOpenAI — and a fresh OpenAI SDK client
    // with it — on every LLM call, which under worker load is thousands of
    // short-lived clients on the heap.
    const svc = svcWith();

    expect(svc.getLLM({ temperature: 0.4 })).toBe(svc.getLLM({ temperature: 0.4 }));
  });

  it("keys on every parameter that is baked into the client", () => {
    const svc = svcWith();
    const base = svc.getLLM({ temperature: 0.4 });

    expect(svc.getLLM({ temperature: 0.5 })).not.toBe(base);
    // timeoutMs is baked into the client's own request budget — sharing across
    // budgets would silently give a caller someone else's timeout.
    expect(svc.getLLM({ temperature: 0.4, timeoutMs: 30_000 })).not.toBe(base);
    expect(svc.getLLM({ temperature: 0.4, maxOutputTokens: 512 })).not.toBe(base);
    expect(svc.getLLM({ temperature: 0.4, frequencyPenalty: 0.5 })).not.toBe(base);
  });

  it("keys on the RESOLVED reasoning effort, so both spellings share one entry", () => {
    const svc = svcWith();

    expect(svc.getLLM({ disableThinking: true })).toBe(svc.getLLM({ reasoningEffort: "none" }));
  });

  it("keeps the tiers apart", () => {
    const svc = makeService({
      ai: tier({ model: "normal" }),
      aiLite: tier({ model: "lite" }),
      aiLarge: tier({ model: "large" }),
    });

    expect(svc.getLLM({ modelWeight: ModelWeight.Lite })).not.toBe(svc.getLLM());
  });

  it("never shares a MOCK_AI model — FakeListChatModel walks a response list", () => {
    const svc = makeService({ mock: true, ai: tier(), aiLite: tier(), aiLarge: tier() });

    expect(svc.getLLM()).not.toBe(svc.getLLM());
  });

  it("never shares a region-pinned OpenRouter client — its escalating fetch is per call", () => {
    // Attempt 1 hard-pins the provider and retries allow fallbacks; a shared
    // instance would stay escalated for every later call.
    const svc = svcWith({ provider: "openrouter", region: "together" });

    expect(svc.getLLM()).not.toBe(svc.getLLM());
  });

  it("caches an unpinned OpenRouter client", () => {
    const svc = svcWith({ provider: "openrouter", region: undefined });

    expect(svc.getLLM()).toBe(svc.getLLM());
  });
});

// === AI connections: candidate chains ====================================
// Backward compatibility is the point of the @Optional() resolver: with no
// resolver wired, every modality resolves to exactly ONE candidate built from
// the `.env` config, and behaviour is byte-for-byte what it was.
describe("ModelService candidates without a resolver", () => {
  const svc = () =>
    makeService({
      ai: tier({ model: "normal" }),
      aiLite: tier({ model: "lite" }),
      aiLarge: tier({ model: "large" }),
      vision: tier({ model: "vision-model", provider: "azure" }),
      embedder: { provider: "openai", apiKey: "e", model: "embed", url: "", dimensions: 1536 },
      transcriber: { provider: "openai", apiKey: "t", model: "whisper" },
    });

  it("returns exactly one env candidate per chat tier", () => {
    const candidates = svc().getCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe("env");
    expect(candidates[0].connectionId).toBe("env:ai");
    expect(candidates[0].connectionType).toBe("ai");
    expect(candidates[0].model).toBe("normal");
  });

  it("maps each weight onto its own connection type", () => {
    expect(svc().getCandidates(ModelWeight.Lite)[0]).toMatchObject({ connectionId: "env:aiLite", model: "lite" });
    expect(svc().getCandidates(ModelWeight.Large)[0]).toMatchObject({ connectionId: "env:aiLarge", model: "large" });
  });

  it("maps the non-chat modalities from their own config blocks", () => {
    expect(svc().getCandidatesForType("vision")[0]).toMatchObject({
      connectionId: "env:vision",
      provider: "azure",
      model: "vision-model",
    });
    expect(svc().getCandidatesForType("embedder")[0]).toMatchObject({ connectionId: "env:embedder", dimensions: 1536 });
    expect(svc().getCandidatesForType("transcriber")[0]).toMatchObject({
      connectionId: "env:transcriber",
      model: "whisper",
    });
  });

  it("survives a config that never declared the block being asked for", () => {
    // Half the existing harnesses configure the chat tiers and nothing else.
    const bare = makeService({ ai: tier(), aiLite: tier(), aiLarge: tier() });

    expect(bare.getCandidatesForType("documentAi")[0]).toMatchObject({ connectionId: "env:documentAi", provider: "" });
  });

  it("keeps getLLM's client cache stable across calls", () => {
    const service = svc();

    expect(service.getLLM()).toBe(service.getLLM());
  });

  it("no-ops on notifyCandidateFailure", () => {
    const service = svc();

    expect(() => service.notifyCandidateFailure(service.getCandidates()[0])).not.toThrow();
  });
});

describe("ModelService candidates with a resolver", () => {
  const envConfig = () => ({
    ai: tier({ model: "env-model", secret: "env-secret" }),
    aiLite: tier({ model: "lite" }),
    aiLarge: tier({ model: "large" }),
  });

  it("builds getLLM from the resolver's FIRST candidate by default", () => {
    const resolver = stubResolver({
      ai: [dbCandidate(), dbCandidate({ connectionId: "conn-2", model: "second-model" })],
    });
    const llm = makeServiceWithResolver(envConfig(), resolver).getLLM() as any;

    expect(llm.model ?? llm.modelName).toBe("db-model");
    expect(llm.clientConfig?.baseURL ?? llm.configuration?.baseURL).toBe("https://primary.example.com/v1");
  });

  it("builds from the NEXT candidate when candidateIndex advances", () => {
    const resolver = stubResolver({
      ai: [
        dbCandidate(),
        dbCandidate({ connectionId: "conn-2", model: "second-model", url: "https://backup.example.com/v1" }),
      ],
    });
    const llm = makeServiceWithResolver(envConfig(), resolver).getLLM({ candidateIndex: 1 }) as any;

    expect(llm.model ?? llm.modelName).toBe("second-model");
    expect(llm.clientConfig?.baseURL ?? llm.configuration?.baseURL).toBe("https://backup.example.com/v1");
  });

  it("clamps an out-of-range candidateIndex to the last link instead of crashing", () => {
    const resolver = stubResolver({
      ai: [dbCandidate(), dbCandidate({ connectionId: "conn-2", model: "second-model" })],
    });
    const llm = makeServiceWithResolver(envConfig(), resolver).getLLM({ candidateIndex: 9 }) as any;

    expect(llm.model ?? llm.modelName).toBe("second-model");
  });

  it("gives every connection its own cache entry, even when nothing else differs", () => {
    // Two links of one chain can be indistinguishable on provider/model/url and
    // still be different deployments with different credentials.
    const resolver = stubResolver({ ai: [dbCandidate(), dbCandidate({ connectionId: "conn-2" })] });
    const service = makeServiceWithResolver(envConfig(), resolver);

    expect(service.getLLM({ candidateIndex: 0 })).toBe(service.getLLM({ candidateIndex: 0 }));
    expect(service.getLLM({ candidateIndex: 1 })).not.toBe(service.getLLM({ candidateIndex: 0 }));
  });

  it("asks the resolver for the type matching the requested weight", () => {
    const resolver = stubResolver({ aiLite: [dbCandidate({ connectionType: "aiLite", model: "db-lite" })] });
    const llm = makeServiceWithResolver(envConfig(), resolver).getLLM({ modelWeight: ModelWeight.Lite }) as any;

    expect(resolver.resolve).toHaveBeenCalledWith("aiLite");
    expect(llm.model ?? llm.modelName).toBe("db-lite");
  });

  it("reflects the first candidate in getResolvedConfig while keeping env-only fields", () => {
    const resolver = stubResolver({ ai: [dbCandidate({ provider: "azure", instance: "inst" })] });
    const resolved = makeServiceWithResolver(envConfig(), resolver).getResolvedConfig();

    expect(resolved.provider).toBe("azure");
    expect(resolved.model).toBe("db-model");
    // `secret` has no home on a candidate — it must survive the merge.
    expect(resolved.secret).toBe("env-secret");
  });

  it("keeps supportsStrictStructuredOutput answering from the resolved candidate", () => {
    const resolver = stubResolver({ ai: [dbCandidate({ provider: "vertex" })] });

    expect(makeServiceWithResolver(envConfig(), resolver).supportsStrictStructuredOutput()).toBe(false);
  });

  it("forwards notifyCandidateFailure to the resolver's markFailure", () => {
    const resolver = stubResolver({ ai: [dbCandidate()] });
    const service = makeServiceWithResolver(envConfig(), resolver);

    service.notifyCandidateFailure(service.getCandidates()[0]);

    expect(resolver.markFailure).toHaveBeenCalledWith("conn-1");
  });

  it("falls back to the env candidate when the resolver returns an empty chain", () => {
    const resolver = stubResolver({});
    const candidates = makeServiceWithResolver(envConfig(), resolver).getCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ source: "env", connectionId: "env:ai", model: "env-model" });
  });

  it("falls back to the env candidate when the resolver THROWS (degrade to .env, never to no AI)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolver = {
      resolve: vi.fn(() => {
        throw new Error("snapshot unavailable");
      }),
      markFailure: vi.fn(),
    };

    const candidates = makeServiceWithResolver(envConfig(), resolver).getCandidates();

    expect(candidates[0]).toMatchObject({ source: "env", model: "env-model" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("AI connection resolver failed"));
    warn.mockRestore();
  });

  it("short-circuits MOCK_AI before consulting the resolver at all", () => {
    const resolver = stubResolver({ ai: [dbCandidate()] });
    const service = makeServiceWithResolver({ mock: true, ...envConfig() }, resolver);

    expect(service.getLLM()).not.toBe(service.getLLM());
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it("resolves the embedder dimensions from the first candidate, falling back to config", () => {
    const config = {
      ...envConfig(),
      embedder: { provider: "openai", apiKey: "e", model: "embed", url: "", dimensions: 1536 },
    };
    const withDimensions = stubResolver({
      embedder: [dbCandidate({ connectionType: "embedder", provider: "openai", dimensions: 3072 })],
    });
    const withoutDimensions = stubResolver({
      embedder: [dbCandidate({ connectionType: "embedder", provider: "openai" })],
    });

    expect(makeServiceWithResolver(config, withDimensions).getEmbedderDimensions()).toBe(3072);
    expect(makeServiceWithResolver(config, withoutDimensions).getEmbedderDimensions()).toBe(1536);
  });

  it("builds the vision model from the vision chain", () => {
    const resolver = stubResolver({
      vision: [dbCandidate({ connectionType: "vision", model: "db-vision", url: "https://vision.example.com/v1" })],
    });
    const llm = makeServiceWithResolver({ ...envConfig(), vision: tier() }, resolver).getVisionLLM() as any;

    expect(resolver.resolve).toHaveBeenCalledWith("vision");
    expect(llm.model ?? llm.modelName).toBe("db-vision");
  });

  it("builds the transcriber from the transcriber chain", () => {
    const resolver = stubResolver({
      transcriber: [dbCandidate({ connectionType: "transcriber", provider: "openai", apiKey: "db-transcriber-key" })],
    });
    const config = { ...envConfig(), transcriber: { provider: "openai", apiKey: "env-key", model: "whisper" } };

    const transcriber = makeServiceWithResolver(config, resolver).getTranscriber() as any;

    expect(resolver.resolve).toHaveBeenCalledWith("transcriber");
    expect(transcriber.apiKey).toBe("db-transcriber-key");
  });
});
