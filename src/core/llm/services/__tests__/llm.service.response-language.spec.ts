import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ModelWeight } from "../../enums/model.weight";
import { buildResponseLanguageInstruction } from "../../utils/response-language-instruction";
import { buildCacheKey } from "../llm-cache.service";
import { LLMService } from "../llm.service";

vi.mock("@langchain/core/messages", () => ({
  AIMessage: class {
    content = "";
    tool_calls: any[] = [];
  },
  BaseMessage: class {},
  HumanMessage: class {
    constructor(public content: string) {}
  },
  SystemMessage: class {
    constructor(public content: string) {}
  },
  ToolMessage: class {
    constructor(opts: { content: string; tool_call_id: string }) {
      Object.assign(this, opts);
    }
  },
}));

vi.mock("@langchain/core/prompts", () => ({
  ChatPromptTemplate: {
    fromMessages: vi.fn().mockReturnValue({ formatMessages: vi.fn().mockResolvedValue([]) }),
  },
  MessagesPlaceholder: class {
    constructor(public name: string) {}
  },
}));

vi.mock("@langchain/core/tools", () => ({
  DynamicStructuredTool: class {
    constructor(public fields: any) {}
  },
}));

const ITALIAN_LINE = buildResponseLanguageInstruction("it") as string;
const SYSTEM_PROMPTS = ["You are a helpful assistant.", "Answer briefly."];
const OUTPUT = z.object({ ok: z.boolean() });

function harness(opts: { resolver?: { resolve: () => Promise<string | undefined> }; cache?: any }) {
  const modelService = {
    getResolvedConfig: () => ({ model: "m", provider: "openrouter" }),
    getLLM: vi.fn(),
  } as any;
  const dumper = {
    startSession: () => ({
      recordInputs: vi.fn(),
      startIteration: vi.fn(),
      recordResponse: vi.fn(),
      recordToolResult: vi.fn(),
      close: vi.fn(),
    }),
  } as any;
  const config = {
    get: vi.fn().mockReturnValue({ mock: false, requestTimeoutMs: 40_000, requestWatchdogMs: 10_000 }),
  } as any;
  const tokenUsage = { recordTokenUsage: vi.fn(), computeCost: vi.fn() } as any;
  const svc = new LLMService(modelService, config, dumper, tokenUsage, opts.cache, undefined, opts.resolver as any);
  const invoke = vi
    .spyOn(svc as any, "_invokeOriginal")
    .mockResolvedValue({ ok: true, tokenUsage: { input: 1, output: 1 } });
  return { svc, invoke };
}

const sentSystemPrompts = (invoke: ReturnType<typeof vi.fn> | any): string[] => invoke.mock.calls[0][0].systemPrompts;

describe("LLMService response-language line", () => {
  afterEach(() => vi.restoreAllMocks());

  it("appends the line as the last system prompt when the resolver returns it", async () => {
    const { svc, invoke } = harness({ resolver: { resolve: vi.fn().mockResolvedValue("it") } });

    await svc.call({ systemPrompts: SYSTEM_PROMPTS, inputParams: { a: 1 }, outputSchema: OUTPUT });

    const sent = sentSystemPrompts(invoke);
    expect(sent).toEqual([...SYSTEM_PROMPTS, ITALIAN_LINE]);
    expect(sent[sent.length - 1]).toBe(ITALIAN_LINE);
    // The caller's array is never mutated.
    expect(SYSTEM_PROMPTS).toHaveLength(2);
  });

  it("includes the line in the cache key input", async () => {
    const cache = { get: vi.fn().mockResolvedValue({ ok: true, tokenUsage: { input: 0, output: 0 } }), set: vi.fn() };
    const { svc, invoke } = harness({ resolver: { resolve: vi.fn().mockResolvedValue("it") }, cache });
    const inputParams = { a: 1 };

    await svc.call({ systemPrompts: SYSTEM_PROMPTS, inputParams, outputSchema: OUTPUT, cacheable: true });

    const expectedKey = buildCacheKey({
      modelWeight: ModelWeight.Normal,
      temperature: undefined,
      systemPrompts: [...SYSTEM_PROMPTS, ITALIAN_LINE],
      prompt: JSON.stringify(inputParams),
    });
    const englishKey = buildCacheKey({
      modelWeight: ModelWeight.Normal,
      temperature: undefined,
      systemPrompts: SYSTEM_PROMPTS,
      prompt: JSON.stringify(inputParams),
    });
    expect(cache.get).toHaveBeenCalledWith(expectedKey);
    expect(expectedKey).not.toBe(englishKey);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("appends nothing with skipResponseLanguage: true", async () => {
    const resolve = vi.fn().mockResolvedValue("it");
    const { svc, invoke } = harness({ resolver: { resolve } });

    await svc.call({
      systemPrompts: SYSTEM_PROMPTS,
      inputParams: { a: 1 },
      outputSchema: OUTPUT,
      skipResponseLanguage: true,
    });

    expect(sentSystemPrompts(invoke)).toEqual(SYSTEM_PROMPTS);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("leaves systemPrompts identical when the resolver returns undefined (disabled)", async () => {
    const { svc, invoke } = harness({ resolver: { resolve: vi.fn().mockResolvedValue(undefined) } });

    await svc.call({ systemPrompts: SYSTEM_PROMPTS, inputParams: { a: 1 }, outputSchema: OUTPUT });

    expect(sentSystemPrompts(invoke)).toBe(SYSTEM_PROMPTS);
  });

  it("leaves systemPrompts identical when the resolver returns en", async () => {
    const { svc, invoke } = harness({ resolver: { resolve: vi.fn().mockResolvedValue("en") } });

    await svc.call({ systemPrompts: SYSTEM_PROMPTS, inputParams: { a: 1 }, outputSchema: OUTPUT });

    expect(sentSystemPrompts(invoke)).toBe(SYSTEM_PROMPTS);
  });

  it("appends nothing when no resolver is injected", async () => {
    const { svc, invoke } = harness({});

    await svc.call({ systemPrompts: SYSTEM_PROMPTS, inputParams: { a: 1 }, outputSchema: OUTPUT });

    expect(sentSystemPrompts(invoke)).toBe(SYSTEM_PROMPTS);
  });
});
