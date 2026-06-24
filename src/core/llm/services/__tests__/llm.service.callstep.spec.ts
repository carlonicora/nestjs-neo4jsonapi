import { vi, describe, it, expect } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
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
      type = "tool";
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

function makeService(response: any) {
  const invoke = vi.fn().mockResolvedValue(response);
  const model = {
    bindTools: vi.fn().mockReturnValue({ invoke }),
    withStructuredOutput: vi.fn(),
    invoke: vi.fn(),
  };
  const modelService = {
    getLLM: vi.fn().mockReturnValue(model),
    getResolvedConfig: vi.fn().mockReturnValue({ model: "test-model", provider: "openrouter" }),
  } as any;
  const session = {
    recordInputs: vi.fn(),
    startIteration: vi.fn(),
    recordResponse: vi.fn(),
    recordToolResult: vi.fn(),
    close: vi.fn(),
  };
  const dumper = {
    startSession: vi.fn().mockReturnValue(session),
  } as any;
  const configService = { get: vi.fn() } as any;
  // Constructor order: (modelService, config, dumper)
  const svc = new LLMService(modelService, configService, dumper);
  return { svc, model, invoke, session, dumper, modelService };
}

function makeTool(name: string) {
  return {
    name,
    description: `${name} tool`,
    schema: {},
    invoke: vi.fn(),
    func: vi.fn(),
  } as any;
}

describe("LLMService.callStep", () => {
  const toolCalls = [{ id: "call-1", name: "do_thing", args: { a: 1 } }];
  const response = {
    content: "",
    tool_calls: toolCalls,
    usage_metadata: { input_tokens: 100, output_tokens: 40 },
    response_metadata: { finish_reason: "tool_calls" },
  };

  it("returns the AIMessage with tool_calls untouched, without executing tools (no loop)", async () => {
    const tool = makeTool("do_thing");
    const { svc, model, invoke } = makeService(response);

    const out = await svc.callStep({
      systemPrompts: ["you are an operator"],
      messages: [new HumanMessage("create a quote")],
      tools: [tool],
    });

    // Single invocation, tools bound, no internal loop
    expect(model.bindTools).toHaveBeenCalledTimes(1);
    expect(model.bindTools).toHaveBeenCalledWith([tool]);
    expect(invoke).toHaveBeenCalledTimes(1);

    // The tool itself must never be executed by callStep
    expect(tool.invoke).not.toHaveBeenCalled();
    expect(tool.func).not.toHaveBeenCalled();

    // The raw AIMessage is returned with tool_calls untouched
    expect(out.message).toBe(response);
    expect((out.message as any).tool_calls).toEqual(toolCalls);
  });

  it("prepends system prompts to the provided messages on invocation", async () => {
    const tool = makeTool("do_thing");
    const { svc, invoke } = makeService(response);

    const userMessage = new HumanMessage("hello");
    await svc.callStep({
      systemPrompts: ["prompt one", "prompt two"],
      messages: [userMessage],
      tools: [tool],
    });

    const sentMessages = invoke.mock.calls[0][0];
    expect(sentMessages).toHaveLength(3);
    expect(sentMessages[0].type).toBe("system");
    expect(sentMessages[0].content).toBe("prompt one");
    expect(sentMessages[1].type).toBe("system");
    expect(sentMessages[1].content).toBe("prompt two");
    expect(sentMessages[2]).toBe(userMessage);
  });

  it("maps usage metadata to tokens and accounts them into the session exactly once", async () => {
    const tool = makeTool("do_thing");
    const { svc } = makeService(response);

    const out = await svc.callStep({
      systemPrompts: ["sys"],
      messages: [new HumanMessage("hi")],
      tools: [tool],
    });

    expect(out.tokenUsage).toEqual({ input: 100, output: 40 });
    expect(svc.getSessionUsage()).toEqual({
      input: 100,
      output: 40,
      total: 140,
      callCount: 1,
    });
  });

  it("invokes the dumper hooks when enabled", async () => {
    const tool = makeTool("do_thing");
    const { svc, session, dumper } = makeService(response);

    await svc.callStep({
      systemPrompts: ["sys"],
      messages: [new HumanMessage("hi")],
      tools: [tool],
      temperature: 0.2,
      metadata: { task: "operator-step" },
    });

    expect(dumper.startSession).toHaveBeenCalledTimes(1);
    expect(dumper.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        provider: "openrouter",
        temperature: 0.2,
        metadata: { task: "operator-step" },
      }),
    );
    expect(session.recordInputs).toHaveBeenCalledTimes(1);
    expect(session.startIteration).toHaveBeenCalledTimes(1);
    expect(session.recordResponse).toHaveBeenCalledTimes(1);
    expect(session.recordResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenUsage: { input: 100, output: 40 },
        toolCalls: [{ id: "call-1", name: "do_thing", args: { a: 1 } }],
      }),
    );
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledWith(
      expect.objectContaining({
        finalStatus: "success",
        totalTokens: { input: 100, output: 40 },
      }),
    );
  });

  it("closes the dump session with error status and rethrows when the model fails", async () => {
    const tool = makeTool("do_thing");
    const { svc, session, invoke } = makeService(response);
    invoke.mockRejectedValueOnce(new Error("model exploded"));

    await expect(
      svc.callStep({
        systemPrompts: ["sys"],
        messages: [new HumanMessage("hi")],
        tools: [tool],
      }),
    ).rejects.toThrow(/model exploded/);

    expect(session.close).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledWith(
      expect.objectContaining({ finalStatus: "error", errorMessage: expect.stringContaining("model exploded") }),
    );

    // No tokens accounted on failure
    expect(svc.getSessionUsage()).toEqual({ input: 0, output: 0, total: 0, callCount: 0 });
  });
});
