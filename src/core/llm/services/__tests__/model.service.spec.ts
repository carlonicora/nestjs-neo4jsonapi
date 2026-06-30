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
  it("installs an escalating-fetch on the OpenAI client when a region is pinned (no static modelKwargs.provider)", () => {
    const svc = makeService({
      ai: tier({ provider: "openrouter", region: "together", allowFallbacks: false }),
      aiLite: tier(),
      aiLarge: tier(),
    });
    const llm = svc.getLLM() as any;
    const fetchFn = llm.clientConfig?.fetch ?? llm.configuration?.fetch;
    expect(typeof fetchFn).toBe("function");
    // The provider routing is now injected by the fetch middleware, not via modelKwargs.
    expect(llm.modelKwargs?.provider).toBeUndefined();
  });

  it("does not install a fetch when no region is configured", () => {
    const svc = makeService({
      ai: tier({ provider: "openrouter", region: undefined }),
      aiLite: tier(),
      aiLarge: tier(),
    });
    const llm = svc.getLLM() as any;
    const fetchFn = llm.clientConfig?.fetch ?? llm.configuration?.fetch;
    expect(fetchFn).toBeUndefined();
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
