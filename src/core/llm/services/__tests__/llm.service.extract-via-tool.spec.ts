import { vi, describe, it, expect } from "vitest";
import { z } from "zod";
import { LLMService } from "../llm.service";

vi.mock("@langchain/core/messages", () => {
  class MockAIMessage {
    content = "";
    tool_calls: any[] = [];
    type = "ai";
    constructor(content?: string) {
      if (typeof content === "string") this.content = content;
    }
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

type MockResponse = { tool_calls?: any[]; content?: string };

/**
 * Each entry in `responses` is returned by a successive `invoke()` call, so a
 * test can model the first attempt and the retry independently. Any calls
 * beyond the provided list resolve to an empty response.
 */
function makeService(responses: MockResponse[]) {
  const invoke = vi.fn();
  for (const r of responses) {
    invoke.mockResolvedValueOnce({ tool_calls: r.tool_calls ?? [], content: r.content ?? "" });
  }
  invoke.mockResolvedValue({ tool_calls: [], content: "" });
  const model = {
    bindTools: vi.fn().mockReturnValue({ invoke }),
    withStructuredOutput: vi.fn(),
    invoke: vi.fn(),
  };
  const modelService = {
    getLLM: vi.fn().mockReturnValue(model),
    getResolvedConfig: vi.fn().mockReturnValue({ model: "test-model", provider: "ollama" }),
  } as any;
  const dumper = {
    startSession: () => ({
      recordInputs: vi.fn(),
      startIteration: vi.fn(),
      recordResponse: vi.fn(),
      close: vi.fn(),
    }),
  } as any;
  const configService = { get: vi.fn() } as any;
  // Constructor order: (modelService, config, dumper)
  const svc = new LLMService(modelService, configService, dumper);
  return { svc, model, invoke };
}

describe("LLMService.extractViaTool", () => {
  const tool = {
    name: "select_responders",
    description: "pick npcs",
    schema: z.object({ responders: z.array(z.string()) }),
  };

  it("returns the validated tool-call args", async () => {
    const { svc, model } = makeService([
      { tool_calls: [{ name: "select_responders", args: { responders: ["Zoe"] } }] },
    ]);
    const out = await svc.extractViaTool<{ responders: string[] }>({
      systemPrompts: ["you are a director"],
      prompt: "who responds?",
      tool,
    });
    expect(out).toEqual({ responders: ["Zoe"] });
    expect(model.bindTools).toHaveBeenCalledWith(expect.any(Array), { tool_choice: "select_responders" });
  });

  it("salvages structured output from message content when the model returns no tool call", async () => {
    // Ollama/Gemma frequently ignore the forced `tool_choice` and emit the
    // structured payload as plain JSON text instead of a real tool call.
    const { svc, invoke } = makeService([{ content: JSON.stringify({ responders: ["Zoe"] }) }]);
    const out = await svc.extractViaTool<{ responders: string[] }>({
      systemPrompts: [],
      prompt: "who responds?",
      tool,
    });
    expect(out).toEqual({ responders: ["Zoe"] });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("salvages JSON embedded in prose and code fences", async () => {
    const content = 'Sure, here is the result:\n```json\n{ "responders": ["Zoe", "James"] }\n```\nLet me know!';
    const { svc } = makeService([{ content }]);
    const out = await svc.extractViaTool<{ responders: string[] }>({ systemPrompts: [], prompt: "x", tool });
    expect(out).toEqual({ responders: ["Zoe", "James"] });
  });

  it('salvages Gemma\'s malformed pseudo-token tool-call text (name{key:<|"|>value<|"|>}<tool_call|>)', async () => {
    // Verbatim shape observed from gemma4:26b-mlx over Ollama: the forced tool
    // call is emitted as TEXT with `<|"|>` pseudo-quote delimiters and a
    // `<tool_call|>` terminator, which Ollama returns as content (tool_calls=[]).
    const intentTool = {
      name: "decide_intent",
      description: "decide",
      schema: z.object({ says: z.string(), attempts: z.string(), innerBeat: z.string() }),
    };
    const content =
      'decide_intent{attempts:<|"|>Clutches the console to anchor herself.<|"|>,' +
      'innerBeat:<|"|>Adrenaline still coursing; curiosity overrides focus.<|"|>,' +
      'says:<|"|>I am perfectly capable, Commander." She pauses, eyes on the display.<|"|>}<tool_call|>';
    const { svc, invoke } = makeService([{ content }]);
    const out = await svc.extractViaTool<{ says: string; attempts: string; innerBeat: string }>({
      systemPrompts: [],
      prompt: "x",
      tool: intentTool,
    });
    expect(out).toEqual({
      attempts: "Clutches the console to anchor herself.",
      innerBeat: "Adrenaline still coursing; curiosity overrides focus.",
      says: 'I am perfectly capable, Commander." She pauses, eyes on the display.',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("parses tool-call args delivered as a JSON string", async () => {
    // Some providers leave `args` as the raw JSON arguments string rather than a
    // parsed object.
    const { svc } = makeService([
      { tool_calls: [{ name: "select_responders", args: JSON.stringify({ responders: ["Zoe"] }) }] },
    ]);
    const out = await svc.extractViaTool<{ responders: string[] }>({ systemPrompts: [], prompt: "x", tool });
    expect(out).toEqual({ responders: ["Zoe"] });
  });

  it("unwraps tool-call args nested under a single wrapper key", async () => {
    // Some models wrap the payload under a single key (often the tool name):
    // { select_responders: { responders: [...] } }.
    const { svc } = makeService([
      { tool_calls: [{ name: "select_responders", args: { select_responders: { responders: ["Zoe"] } } }] },
    ]);
    const out = await svc.extractViaTool<{ responders: string[] }>({ systemPrompts: [], prompt: "x", tool });
    expect(out).toEqual({ responders: ["Zoe"] });
  });

  it("retries once with a nudge when the first attempt yields nothing usable", async () => {
    const { svc, invoke } = makeService([
      { content: "I'm not able to help with that." },
      { tool_calls: [{ name: "select_responders", args: { responders: ["Zoe"] } }] },
    ]);
    const out = await svc.extractViaTool<{ responders: string[] }>({ systemPrompts: [], prompt: "x", tool });
    expect(out).toEqual({ responders: ["Zoe"] });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("throws when neither a tool call, salvageable content, nor a retry yields output", async () => {
    const { svc } = makeService([{ content: "no." }, { content: "still no." }]);
    await expect(svc.extractViaTool({ systemPrompts: [], prompt: "x", tool })).rejects.toThrow(/did not call the tool/);
  });
});
