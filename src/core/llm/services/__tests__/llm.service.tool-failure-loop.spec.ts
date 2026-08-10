import { vi, describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { LLMService } from "../llm.service";
import { REPEATED_TOOL_FAILURE_LIMIT } from "../tool-error-feedback";

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
    fromMessages: vi.fn().mockReturnValue({ formatMessages: vi.fn().mockResolvedValue([]) }),
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

/**
 * Verbatim reproduction of the observed failure: gemini-2.5-flash-lite emitted
 * `read_entity` without the required `type`, and re-emitted it — with the keys
 * in varying order — until all 15 iterations were spent (108k input tokens).
 */
const readEntitySchema = z.object({
  type: z.string(),
  id: z.string(),
  include: z.array(z.string()).optional(),
});

const MALFORMED_ARGS = [
  { id: "npc-1", include: ["campaign", "factions"] },
  // Same call, keys shuffled — this is what the model actually does.
  { include: ["campaign", "factions"], id: "npc-1" },
  { id: "npc-1", include: ["campaign", "factions"] },
  { include: ["campaign", "factions"], id: "npc-1" },
  { id: "npc-1", include: ["campaign", "factions"] },
];

describe("LLMService tool loop — repeated schema rejections", () => {
  let toolMessages: Array<{ content: string }>;

  const buildService = (argsSequence: Array<Record<string, unknown>>) => {
    toolMessages = [];

    const tool: any = {
      name: "read_entity",
      description: "Fetches one record by id.",
      schema: readEntitySchema,
      // Mirrors DynamicStructuredTool.call: the schema is validated before the
      // tool's own code runs, so a bad call throws rather than returning.
      invoke: vi.fn(async (args: unknown) => {
        const parsed = readEntitySchema.safeParse(args);
        if (!parsed.success) throw new Error("Received tool input did not match expected schema");
        return "{}";
      }),
    };

    const bound = { invoke: vi.fn() };
    for (const args of argsSequence) {
      bound.invoke.mockResolvedValueOnce({
        content: "",
        tool_calls: [{ id: `c${argsSequence.indexOf(args)}`, name: "read_entity", args }],
        usage_metadata: { input_tokens: 10, output_tokens: 5 },
      });
    }
    bound.invoke.mockResolvedValue({ content: "", tool_calls: [], usage_metadata: {} });

    const mockLLM = {
      bindTools: vi.fn().mockReturnValue(bound),
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          parsed: { response: "done" },
          raw: { usage_metadata: { input_tokens: 1, output_tokens: 1 } },
        }),
      }),
      invoke: vi.fn(),
    };

    const modelService = {
      getLLM: vi.fn().mockReturnValue(mockLLM),
      getResolvedConfig: vi.fn().mockReturnValue({ model: "google/gemini-2.5-flash-lite", provider: "openrouter" }),
      supportsStrictStructuredOutput: vi.fn().mockReturnValue(true),
    } as any;

    const dumper = {
      startSession: () => ({
        isEnabled: false,
        recordInputs: vi.fn(),
        startIteration: vi.fn(),
        recordResponse: vi.fn(),
        recordToolResult: vi.fn((_id: string, _name: string, content: string) => toolMessages.push({ content })),
        close: vi.fn(),
      }),
    } as any;

    const configService = {
      get: vi.fn((key: string) =>
        key === "ai"
          ? { provider: "openrouter", model: "google/gemini-2.5-flash-lite", apiKey: "k", url: "u" }
          : undefined,
      ),
    } as any;
    const service = new LLMService(modelService, configService, dumper);
    return { service, bound, tool };
  };

  beforeEach(() => vi.clearAllMocks());

  const run = (service: LLMService, tool: any) =>
    service.call({
      systemPrompts: ["s"],
      inputParams: { q: "What can you tell me about Fabio?" },
      outputSchema: z.object({ response: z.string() }),
      tools: [tool],
      maxToolIterations: 15,
    });

  it("replies to a schema rejection with the missing argument instead of the generic LangChain message", async () => {
    const { service, tool } = buildService(MALFORMED_ARGS);

    await run(service, tool);

    expect(toolMessages[0].content).toContain('Missing required argument "type"');
    expect(toolMessages[0].content).toContain("Required arguments for read_entity: type, id");
    expect(toolMessages[0].content).not.toContain("Received tool input did not match expected schema");
  });

  it("abandons the tool loop once the same rejected call repeats, instead of burning every iteration", async () => {
    const { service, bound, tool } = buildService(MALFORMED_ARGS);

    await run(service, tool);

    // Key order varies between attempts, so this only holds if the repeat
    // detector canonicalises the arguments.
    expect(bound.invoke).toHaveBeenCalledTimes(REPEATED_TOOL_FAILURE_LIMIT);
    expect(toolMessages[REPEATED_TOOL_FAILURE_LIMIT - 1].content).toContain("Stop calling");
  });

  it("still returns the structured answer after abandoning the loop", async () => {
    const { service, tool } = buildService(MALFORMED_ARGS);

    const result = await run(service, tool);

    expect(result.response).toBe("done");
  });

  it("counts repeats per call signature, so valid calls interleaved with bad ones do not trip it", async () => {
    const { service, bound, tool } = buildService([
      { id: "npc-1" },
      { type: "npcs", id: "npc-1" },
      { id: "npc-1" },
      { type: "npcs", id: "npc-1" },
    ]);

    await run(service, tool);

    // Four model turns, then the fifth returns no tool calls and ends the loop.
    expect(bound.invoke).toHaveBeenCalledTimes(5);
  });
});
