import { vi, describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { LLMService } from "../llm.service";
import { TokenUsageService } from "../../../../foundations/tokenusage/services/tokenusage.service";

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
  class MockToolMessage {
    content: string;
    tool_call_id: string;
    type = "tool";
    constructor(opts: { content: string; tool_call_id: string }) {
      this.content = opts.content;
      this.tool_call_id = opts.tool_call_id;
    }
  }
  return {
    AIMessage: MockAIMessage,
    BaseMessage: class {},
    HumanMessage: MockHumanMessage,
    SystemMessage: MockSystemMessage,
    ToolMessage: MockToolMessage,
  };
});

vi.mock("@langchain/core/prompts", () => ({
  ChatPromptTemplate: {
    // A fresh array per call: a shared one would leak messages between tests.
    fromMessages: vi.fn(() => ({ formatMessages: vi.fn(async () => []) })),
  },
  MessagesPlaceholder: class {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
  },
}));

vi.mock("@langchain/core/tools", () => ({ DynamicStructuredTool: vi.fn() }));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn().mockReturnValue({ chatModel: vi.fn().mockReturnValue({ id: "mock-model" }) }),
}));

vi.mock("../openrouter-fetch", () => ({
  injectOpenRouterProvider: vi.fn(),
  openRouterEscalatingFetch: vi.fn(),
}));

const outputSchema = z.object({
  answer: z.string().describe("The answer"),
  confidence: z.number().describe("Confidence 0-1"),
});

type ModelTurn = { content?: string; tool_calls: Array<{ id: string; name: string; args: unknown }> };

describe("LLMService tool loop — final_answer tool", () => {
  let conversation: any[];

  const buildService = (turns: ModelTurn[]) => {
    const lookup: any = {
      name: "lookup",
      description: "Looks something up.",
      schema: z.object({ q: z.string() }),
      invoke: vi.fn(async () => "lookup result"),
    };

    const bound = { invoke: vi.fn() };
    for (const turn of turns) {
      bound.invoke.mockImplementationOnce(async (messages: any[]) => {
        conversation = messages;
        return {
          content: turn.content ?? "",
          tool_calls: turn.tool_calls,
          usage_metadata: { input_tokens: 10, output_tokens: 5 },
        };
      });
    }
    bound.invoke.mockImplementation(async (messages: any[]) => {
      conversation = messages;
      return { content: "prose answer", tool_calls: [], usage_metadata: { input_tokens: 10, output_tokens: 5 } };
    });

    const structured = {
      invoke: vi.fn(async (messages: any[]) => {
        conversation = messages;
        return {
          parsed: { answer: "structured", confidence: 0.5 },
          raw: { usage_metadata: { input_tokens: 1, output_tokens: 1 } },
        };
      }),
    };

    const mockLLM = {
      bindTools: vi.fn().mockReturnValue(bound),
      withStructuredOutput: vi.fn().mockReturnValue(structured),
      invoke: vi.fn(),
    };

    const modelService = {
      getLLM: vi.fn().mockReturnValue(mockLLM),
      getResolvedConfig: vi.fn().mockReturnValue({ model: "test-model", provider: "openrouter" }),
      supportsStrictStructuredOutput: vi.fn().mockReturnValue(true),
    } as any;

    const dumper = {
      startSession: () => ({
        isEnabled: false,
        recordInputs: vi.fn(),
        startIteration: vi.fn(),
        recordResponse: vi.fn(),
        recordToolResult: vi.fn(),
        close: vi.fn(),
      }),
    } as any;

    const configService = {
      get: vi.fn((key: string) =>
        key === "ai" ? { provider: "openrouter", model: "test-model", apiKey: "k", url: "u" } : undefined,
      ),
    } as any;
    const tokenUsageService = { computeCost: vi.fn(), recordTokenUsage: vi.fn() } as unknown as TokenUsageService;
    const service = new LLMService(modelService, configService, dumper, tokenUsageService);
    const warn = vi.spyOn((service as any).logger, "warn").mockImplementation(() => undefined);
    vi.spyOn((service as any).logger, "log").mockImplementation(() => undefined);
    return { service, bound, structured, mockLLM, lookup, warn };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    conversation = [];
  });

  const run = (service: LLMService, lookup: any, maxToolIterations = 5) =>
    service.call<z.infer<typeof outputSchema>>({
      systemPrompts: ["s"],
      inputParams: { q: "question" },
      outputSchema,
      tools: [lookup],
      maxToolIterations,
    });

  const toolMessages = () => conversation.filter((m) => m.type === "tool");

  it("returns final_answer args as the result without a structured round", async () => {
    const { service, structured, mockLLM, lookup } = buildService([
      { tool_calls: [{ id: "c1", name: "lookup", args: { q: "x" } }] },
      { tool_calls: [{ id: "c2", name: "final_answer", args: { answer: "from tool", confidence: 0.9 } }] },
    ]);

    const result = await run(service, lookup);

    expect(result.answer).toBe("from tool");
    expect(result.confidence).toBe(0.9);
    expect(structured.invoke).not.toHaveBeenCalled();
    expect(mockLLM.withStructuredOutput).not.toHaveBeenCalled();
    expect(result.tokenUsage).toEqual({ input: 20, output: 10, cached: 0 });
  });

  it("binds final_answer beside the caller's tools with the output schema", async () => {
    const { service, mockLLM, lookup } = buildService([
      { tool_calls: [{ id: "c1", name: "final_answer", args: { answer: "a", confidence: 1 } }] },
    ]);

    await run(service, lookup);

    expect(mockLLM.bindTools).toHaveBeenCalledWith([
      lookup,
      expect.objectContaining({
        name: "final_answer",
        schema: outputSchema,
        description: expect.stringContaining("Call this exactly once, alone and after your last lookup"),
      }),
    ]);
  });

  it("falls back to the structured round when no final_answer call arrives", async () => {
    const { service, structured, lookup } = buildService([
      { tool_calls: [{ id: "c1", name: "lookup", args: { q: "x" } }] },
    ]);

    const result = await run(service, lookup);

    expect(structured.invoke).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe("structured");
  });

  it("answers invalid final_answer args with a ToolMessage naming the schema issues", async () => {
    const { service, bound, lookup } = buildService([
      { tool_calls: [{ id: "bad", name: "final_answer", args: { answer: "a" } }] },
      { tool_calls: [{ id: "good", name: "final_answer", args: { answer: "fixed", confidence: 0.4 } }] },
    ]);

    const result = await run(service, lookup);

    expect(result.answer).toBe("fixed");
    expect(bound.invoke).toHaveBeenCalledTimes(2);
    const rejection = toolMessages().find((m) => m.tool_call_id === "bad");
    expect(rejection).toBeDefined();
    expect(rejection.content).toContain("final_answer");
    expect(rejection.content).toContain('"confidence"');
  });

  it("pairs every rejected final_answer call before the structured fallback round", async () => {
    const { service, structured, lookup } = buildService([
      { tool_calls: [{ id: "bad1", name: "final_answer", args: { answer: "a" } }] },
      { tool_calls: [{ id: "bad2", name: "final_answer", args: { confidence: "high" } }] },
    ]);

    await run(service, lookup, 2);

    expect(structured.invoke).toHaveBeenCalledTimes(1);
    const ids = toolMessages().map((m) => m.tool_call_id);
    expect(ids).toEqual(expect.arrayContaining(["bad1", "bad2"]));
  });

  it("logs every fallback", async () => {
    // invalid args, then prose
    const first = buildService([{ tool_calls: [{ id: "bad", name: "final_answer", args: { answer: "a" } }] }]);
    await run(first.service, first.lookup);
    const firstLines = first.warn.mock.calls.map((c) => String(c[0]));
    expect(firstLines.some((l) => /final_answer fallback: .*invalid/i.test(l))).toBe(true);
    expect(firstLines.some((l) => /final_answer fallback: .*prose/i.test(l))).toBe(true);

    // max iterations
    const second = buildService([
      { tool_calls: [{ id: "c1", name: "lookup", args: { q: "x" } }] },
      { tool_calls: [{ id: "c2", name: "lookup", args: { q: "y" } }] },
    ]);
    await run(second.service, second.lookup, 2);
    const secondLines = second.warn.mock.calls.map((c) => String(c[0]));
    expect(secondLines.some((l) => /final_answer fallback: .*maxToolIterations/i.test(l))).toBe(true);
    for (const line of [...firstLines, ...secondLines].filter((l) => l.includes("final_answer fallback"))) {
      expect(line).toMatch(/^\[[^\]]+\] final_answer fallback: /);
    }
  });

  it("accepts a valid final_answer sent alongside other calls, runs the other calls and logs the detector line", async () => {
    const { service, structured, lookup, warn } = buildService([
      {
        tool_calls: [
          { id: "c1", name: "lookup", args: { q: "x" } },
          { id: "c2", name: "final_answer", args: { answer: "together", confidence: 0.7 } },
        ],
      },
    ]);
    const logSpy = vi.spyOn((service as any).logger, "log");

    const result = await run(service, lookup);

    expect(result.answer).toBe("together");
    expect(lookup.invoke).toHaveBeenCalledTimes(1);
    expect(structured.invoke).not.toHaveBeenCalled();
    const lines = [...warn.mock.calls, ...logSpy.mock.calls].map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("final_answer detector: sent alongside other tool calls"))).toBe(true);
  });

  it("names final_answer among the valid tools when the model calls an unknown tool", async () => {
    const { service, lookup } = buildService([
      { tool_calls: [{ id: "c1", name: "nope", args: {} }] },
      { tool_calls: [{ id: "c2", name: "final_answer", args: { answer: "a", confidence: 1 } }] },
    ]);

    await run(service, lookup);

    const notFound = toolMessages().find((m) => m.tool_call_id === "c1");
    expect(notFound.content).toContain("lookup");
    expect(notFound.content).toContain("final_answer");
  });

  it("calls without outputSchema bind no final_answer tool", async () => {
    const { service, mockLLM, lookup } = buildService([]);

    await service
      .call<any>({
        systemPrompts: ["s"],
        inputParams: { q: "question" },
        outputSchema: undefined as any,
        tools: [lookup],
      } as any)
      .catch(() => undefined);

    expect(mockLLM.bindTools).toHaveBeenCalledWith([lookup]);
  });
});
