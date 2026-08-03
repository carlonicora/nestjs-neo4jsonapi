import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LLMService } from "../llm.service";

vi.mock("@langchain/core/messages", () => {
  class MockAIMessage {
    content = "";
    tool_calls: any[] = [];
    type = "ai";
  }
  class MockHumanMessage {
    content: string;
    type = "human";
    constructor(content: string) {
      this.content = content;
    }
  }
  class MockSystemMessage {
    content: string;
    type = "system";
    constructor(content: string) {
      this.content = content;
    }
  }
  return {
    AIMessage: MockAIMessage,
    BaseMessage: class {},
    HumanMessage: MockHumanMessage,
    SystemMessage: MockSystemMessage,
    ToolMessage: class {
      content: string;
      tool_call_id: string;
      constructor(opts: { content: string; tool_call_id: string }) {
        this.content = opts.content;
        this.tool_call_id = opts.tool_call_id;
      }
    },
  };
});

vi.mock("@langchain/core/prompts", () => ({
  ChatPromptTemplate: {
    fromMessages: vi.fn().mockReturnValue({
      formatMessages: vi.fn().mockResolvedValue([]),
    }),
  },
  MessagesPlaceholder: class {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
  },
}));

vi.mock("@langchain/core/tools", () => ({
  DynamicStructuredTool: vi.fn(),
}));

const makeServiceUnderTest = (opts?: { supportsStrict?: boolean; parsed?: unknown; raw?: unknown }) => {
  const invoke = vi.fn().mockResolvedValue({
    parsed: opts?.parsed ?? { a: "x" },
    raw: opts?.raw ?? { usage_metadata: { input_tokens: 1, output_tokens: 2 } },
  });
  const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
  const model = { withStructuredOutput, bindTools: vi.fn() };
  const getLLM = vi.fn().mockReturnValue(model);
  const modelService = {
    getResolvedConfig: () => ({ model: "m", provider: "ollama" }),
    getLLM,
    supportsStrictStructuredOutput: vi.fn().mockReturnValue(opts?.supportsStrict ?? true),
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
  // `ai` config block: an empty object keeps MOCK_AI off and falls back to the
  // module defaults for the timeout/watchdog/deadline knobs.
  const config = { get: vi.fn().mockReturnValue({}) } as any;
  const tokenUsageService = { computeCost: vi.fn(), recordTokenUsage: vi.fn() } as any;
  const service = new LLMService(modelService, config, dumper, tokenUsageService);
  return { service, getLLM, withStructuredOutput, modelService };
};

describe("LLMService reasoning effort", () => {
  it("forwards the per-call reasoningEffort to ModelService.getLLM", async () => {
    const { service, getLLM } = makeServiceUnderTest();
    await service.call({
      systemPrompts: ["s"],
      inputParams: {},
      outputSchema: z.object({ a: z.string() }),
      reasoningEffort: "low",
    });
    expect(getLLM).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: "low" }));
  });

  it("forwards nothing when the call does not ask for an effort", async () => {
    const { service, getLLM } = makeServiceUnderTest();
    await service.call({
      systemPrompts: ["s"],
      inputParams: {},
      outputSchema: z.object({ a: z.string() }),
    });
    expect(getLLM).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: undefined }));
  });
});

// The sibling `utils/__tests__/strict-structured-output.spec.ts` pins the decision
// TABLE against the schema utils. These pin the SERVICE actually taking it — what
// it hands `withStructuredOutput` on each of the three branches.
describe("LLMService structured-output decision", () => {
  it("hands the Zod schema over untouched when the provider ignores strict", async () => {
    const outputSchema = z.object({ a: z.string(), b: z.string().optional() });
    const { service, withStructuredOutput } = makeServiceUnderTest({ supportsStrict: false });
    await service.call({ systemPrompts: ["s"], inputParams: {}, outputSchema });
    expect(withStructuredOutput).toHaveBeenCalledWith(outputSchema, { includeRaw: true });
  });

  it("passes a strict-clean schema through as Zod", async () => {
    const outputSchema = z.object({ a: z.string() });
    const { service, withStructuredOutput } = makeServiceUnderTest();
    await service.call({ systemPrompts: ["s"], inputParams: {}, outputSchema });
    expect(withStructuredOutput).toHaveBeenCalledWith(outputSchema, { includeRaw: true });
  });

  it("sends a rewritten JSON Schema in strict mode when the schema has optionals", async () => {
    const outputSchema = z.object({ a: z.string(), b: z.string().optional() });
    const { service, withStructuredOutput } = makeServiceUnderTest({ parsed: { a: "x", b: null } });
    await service.call({ systemPrompts: ["s"], inputParams: {}, outputSchema });

    const [sentSchema, options] = withStructuredOutput.mock.calls[0];
    expect(options).toEqual({ includeRaw: true, strict: true });
    // A plain JSON Schema, not the Zod object — and the optional key is now required.
    expect(sentSchema).not.toBe(outputSchema);
    expect(new Set(sentSchema.required)).toEqual(new Set(["a", "b"]));
  });

  it("falls back to tool calling for an open record, which strict cannot express", async () => {
    const outputSchema = z.object({ m: z.record(z.string(), z.string()) });
    const { service, withStructuredOutput } = makeServiceUnderTest({ parsed: { m: { k: "v" } } });
    await service.call({ systemPrompts: ["s"], inputParams: {}, outputSchema });
    expect(withStructuredOutput).toHaveBeenCalledWith(outputSchema, {
      includeRaw: true,
      method: "functionCalling",
    });
  });
});

// On the rewritten-strict branch LangChain parses a RAW JSON Schema, so it uses the
// lenient `JsonOutputParser` and does no Zod validation — a truncated payload still
// arrives as a truthy `parsed`. The Zod check therefore happens in the service, and
// its failure must land in the SAME salvage ladder a missing `parsed` lands in.
describe("LLMService strict-branch validation failure", () => {
  const outputSchema = z.object({ a: z.string(), b: z.string().optional() });

  it("reaches the salvage ladder and reports the descriptive error, not a raw ZodError", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { service } = makeServiceUnderTest({
      // Lenient JSON parsing "succeeded" on a truncated payload: `a` is a number, so
      // the caller's schema rejects it.
      parsed: { a: 42, b: null },
      raw: {
        usage_metadata: { input_tokens: 1, output_tokens: 2 },
        response_metadata: { finish_reason: "length" },
        content: '{"a": 42, "b": nu',
      },
    });

    const call = service.call({ systemPrompts: ["s"], inputParams: {}, outputSchema });

    await expect(call).rejects.toThrow(/LLM failed to return structured output/);
    // The diagnostic that only the ladder produces — a bare ZodError carries neither.
    await expect(call).rejects.toThrow(/Finish reason: length/);
    // The raw-content rung was actually attempted.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Attempting fallback JSON parsing"));

    warn.mockRestore();
    error.mockRestore();
  });

  it("salvages from tool_calls when the strict payload fails validation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { service } = makeServiceUnderTest({
      parsed: { a: 42, b: null },
      raw: {
        usage_metadata: { input_tokens: 1, output_tokens: 2 },
        response_metadata: { finish_reason: "length" },
        content: "not json",
        tool_calls: [{ args: { a: "recovered", b: null } }],
      },
    });

    const result = await service.call({ systemPrompts: ["s"], inputParams: {}, outputSchema });

    expect(result.a).toBe("recovered");
    // Stripped, not kept as null: `b` was synthetic-nullable under the rewrite.
    expect(result.b).toBeUndefined();

    warn.mockRestore();
    error.mockRestore();
  });

  it("still returns cleanly when the strict payload DOES validate", async () => {
    const { service } = makeServiceUnderTest({ parsed: { a: "x", b: null } });
    const result = await service.call({ systemPrompts: ["s"], inputParams: {}, outputSchema });
    expect(result.a).toBe("x");
    expect(result.b).toBeUndefined();
  });
});
