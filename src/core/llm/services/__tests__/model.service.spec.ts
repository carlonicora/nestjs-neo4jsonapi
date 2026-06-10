import { describe, it, expect, beforeEach } from "vitest";
import { ModelService } from "../model.service";
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
