import { vi, it, expect } from "vitest";
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

it("forwards disableThinking to getLLM", async () => {
  const model = {
    bindTools: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ tool_calls: [{ name: "t", args: { ok: true } }] }),
    }),
  };
  const modelService = {
    getResolvedConfig: () => ({ model: "m", provider: "ollama" }),
    getLLM: vi.fn().mockReturnValue(model),
  } as any;
  const dumper = {
    startSession: () => ({
      recordInputs: vi.fn(),
      startIteration: vi.fn(),
      recordResponse: vi.fn(),
      close: vi.fn(),
    }),
  } as any;
  const svc = new LLMService(modelService, { get: vi.fn() } as any, dumper);
  await svc.extractViaTool({
    systemPrompts: [],
    prompt: "x",
    tool: { name: "t", description: "d", schema: z.object({ ok: z.boolean() }) },
    disableThinking: true,
  });
  expect(modelService.getLLM).toHaveBeenCalledWith(expect.objectContaining({ disableThinking: true }));
});
