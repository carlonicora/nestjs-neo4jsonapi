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

import { ModelService, validateAiUrl, writeGcpCredentials } from "../model.service";
import { ModelWeight } from "../../enums/model.weight";

function makeService(aiConfig: any): ModelService {
  const configService = { get: (_k: string) => aiConfig } as any;
  const clsService = { get: () => undefined } as any;
  return new ModelService(clsService, configService);
}

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
  const providers = [
    { provider: "azure", instance: "inst", apiVersion: "2024-12-01-preview" },
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
