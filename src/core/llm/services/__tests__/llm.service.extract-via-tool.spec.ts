import { vi, describe, it, expect } from "vitest";
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

function makeService(toolCalls: any[]) {
  const model = {
    bindTools: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ tool_calls: toolCalls }),
    }),
    withStructuredOutput: vi.fn(),
    invoke: vi.fn(),
  };
  const modelService = {
    getLLM: vi.fn().mockReturnValue(model),
    getResolvedConfig: vi.fn().mockReturnValue({ model: "test-model", provider: "openrouter" }),
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
  return { svc, model };
}

describe("LLMService.extractViaTool", () => {
  const tool = {
    name: "select_responders",
    description: "pick npcs",
    schema: z.object({ responders: z.array(z.string()) }),
  };

  it("returns the validated tool-call args", async () => {
    const { svc, model } = makeService([{ name: "select_responders", args: { responders: ["Zoe"] } }]);
    const out = await svc.extractViaTool<{ responders: string[] }>({
      systemPrompts: ["you are a director"],
      prompt: "who responds?",
      tool,
    });
    expect(out).toEqual({ responders: ["Zoe"] });
    expect(model.bindTools).toHaveBeenCalledWith(expect.any(Array), { tool_choice: "select_responders" });
  });

  it("throws when the model does not call the tool", async () => {
    const { svc } = makeService([]);
    await expect(svc.extractViaTool({ systemPrompts: [], prompt: "x", tool })).rejects.toThrow(/did not call the tool/);
  });
});
