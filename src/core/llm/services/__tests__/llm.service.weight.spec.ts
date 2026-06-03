import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { LLMService } from "../llm.service";
import { ModelWeight } from "../../enums/model.weight";

describe("LLMService.call modelWeight", () => {
  it("resolves the weighted config for the dump session and echoes the weight back", async () => {
    // withStructuredOutput must return an object whose invoke returns
    // { parsed: T, raw: LLMRawResponse } so the no-tools path parses correctly.
    const structuredInvokeResult = {
      parsed: { value: "ok" },
      raw: {
        content: JSON.stringify({ value: "ok" }),
        usage_metadata: { input_tokens: 3, output_tokens: 4 },
        response_metadata: { finish_reason: "stop" },
      },
    };
    const fakeModel: any = {
      invoke: vi.fn().mockResolvedValue(structuredInvokeResult),
      bindTools: vi.fn().mockReturnThis(),
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(structuredInvokeResult),
      }),
    };
    const getResolvedConfig = vi.fn().mockReturnValue({ model: "large-model", provider: "openrouter" });
    const modelService: any = { getResolvedConfig, getLLM: vi.fn().mockReturnValue(fakeModel) };

    const session: any = {
      recordInputs: vi.fn(),
      recordResponse: vi.fn(),
      startIteration: vi.fn(),
      close: vi.fn(),
    };
    const dumper: any = { startSession: vi.fn().mockReturnValue(session) };
    // config.get is still called inside _invokeOriginal for Gemini detection;
    // supply a model string to prevent .toLowerCase() from throwing.
    const config: any = {
      get: () => ({ ai: { model: "large-model", provider: "openrouter" }, aiLite: {}, aiLarge: {} }),
    };

    const svc = new LLMService(modelService, config, dumper);

    const result = await svc.call<{ value: string }>({
      inputParams: {},
      outputSchema: z.object({ value: z.string() }),
      systemPrompts: ["sys"],
      instructions: "do it",
      modelWeight: ModelWeight.Large,
    } as any);

    expect(getResolvedConfig).toHaveBeenCalledWith(ModelWeight.Large);
    expect(modelService.getLLM).toHaveBeenCalledWith(expect.objectContaining({ modelWeight: ModelWeight.Large }));
    expect(result.modelWeight).toBe(ModelWeight.Large);
  });

  it("defaults to Normal when no weight is given", async () => {
    const structuredInvokeResult = {
      parsed: { value: "ok" },
      raw: {
        content: JSON.stringify({ value: "ok" }),
        usage_metadata: { input_tokens: 1, output_tokens: 1 },
        response_metadata: { finish_reason: "stop" },
      },
    };
    const fakeModel: any = {
      invoke: vi.fn().mockResolvedValue(structuredInvokeResult),
      bindTools: vi.fn().mockReturnThis(),
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(structuredInvokeResult),
      }),
    };
    const modelService: any = {
      getResolvedConfig: vi.fn().mockReturnValue({ model: "m", provider: "openrouter" }),
      getLLM: vi.fn().mockReturnValue(fakeModel),
    };
    const session: any = {
      recordInputs: vi.fn(),
      recordResponse: vi.fn(),
      startIteration: vi.fn(),
      close: vi.fn(),
    };
    const dumper: any = { startSession: vi.fn().mockReturnValue(session) };
    const config: any = { get: () => ({ ai: { model: "m", provider: "openrouter" }, aiLite: {}, aiLarge: {} }) };

    const svc = new LLMService(modelService, config, dumper);
    const result = await svc.call<{ value: string }>({
      inputParams: {},
      outputSchema: z.object({ value: z.string() }),
      systemPrompts: ["sys"],
      instructions: "do it",
    } as any);

    expect(result.modelWeight).toBe(ModelWeight.Normal);
  });
});
