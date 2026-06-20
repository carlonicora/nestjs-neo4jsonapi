import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as z from "zod";
import { LLMService } from "../llm.service";
import { ModelService } from "../model.service";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";
import { LLMCallDumper } from "../llm-call-dumper.service";
import { TokenUsageService } from "../../../../foundations/tokenusage/services/tokenusage.service";
import { TokenUsageType } from "../../../../foundations/tokenusage/enums/tokenusage.type";

// Mock LangChain modules
vi.mock("@langchain/core/messages", () => {
  class MockAIMessage {
    content: string;
    type = "ai";
    constructor(content: string) {
      this.content = content;
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

vi.mock("@langchain/core/prompts", () => {
  class MockMessagesPlaceholder {
    name: string;
    type = "placeholder";
    constructor(name: string) {
      this.name = name;
    }
  }
  return {
    ChatPromptTemplate: {
      fromMessages: vi.fn().mockReturnValue({
        formatMessages: vi.fn().mockResolvedValue([]),
      }),
    },
    MessagesPlaceholder: MockMessagesPlaceholder,
  };
});

vi.mock("@langchain/core/tools", () => ({
  DynamicStructuredTool: class {
    constructor(opts: any) {
      Object.assign(this, opts);
    }
  },
}));

// Vercel AI SDK — controlled per-test via the exported mocks below. We spread the
// real module so LangSmith's `wrapAISDK(ai)` (which reads generateText/generateObject
// at wrap time) initialises cleanly; only the two streaming fns are stubbed.
const streamObjectMock = vi.fn();
const streamTextMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamObject: (...args: any[]) => streamObjectMock(...args),
    streamText: (...args: any[]) => streamTextMock(...args),
  };
});

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn().mockReturnValue({
    chatModel: vi.fn().mockReturnValue({ id: "mock-model" }),
  }),
}));

vi.mock("../openrouter-fetch", () => ({
  injectOpenRouterProvider: vi.fn(),
  openRouterEscalatingFetch: vi.fn(),
}));

describe("LLMService", () => {
  let service: LLMService;
  let mockModelService: vi.Mocked<ModelService>;
  let mockConfigService: vi.Mocked<ConfigService>;
  let mockLLM: any;
  let mockStructuredLLM: any;

  const startSessionMock = vi.fn();
  const closeMock = vi.fn();
  const recordInputsMock = vi.fn();
  const startIterationMock = vi.fn();
  const recordResponseMock = vi.fn();
  const recordToolResultMock = vi.fn();

  const mockSession = {
    isEnabled: false,
    recordInputs: recordInputsMock,
    startIteration: startIterationMock,
    recordResponse: recordResponseMock,
    recordToolResult: recordToolResultMock,
    close: closeMock,
  };

  const mockDumper = {
    startSession: startSessionMock,
  };

  const recordTokenUsageMock = vi.fn().mockResolvedValue(undefined);
  const mockTokenUsageService = {
    recordTokenUsage: recordTokenUsageMock,
  };

  const TEST_AI_CONFIG = {
    ai: {
      provider: "openrouter",
      model: "openai/gpt-4",
      apiKey: "test-key",
      url: "https://openrouter.ai/api/v1",
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    startSessionMock.mockReturnValue(mockSession);
    recordTokenUsageMock.mockResolvedValue(undefined);

    // Create mock structured LLM that returns parsed output
    mockStructuredLLM = {
      invoke: vi.fn().mockResolvedValue({
        parsed: { response: "test response" },
        raw: {
          usage_metadata: {
            input_tokens: 100,
            output_tokens: 50,
          },
          response_metadata: {
            finish_reason: "stop",
          },
          content: '{"response": "test response"}',
        },
      }),
    };

    // Create mock LLM
    mockLLM = {
      withStructuredOutput: vi.fn().mockReturnValue(mockStructuredLLM),
      bindTools: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          tool_calls: [],
          usage_metadata: { input_tokens: 50, output_tokens: 25 },
        }),
      }),
      invoke: vi.fn().mockResolvedValue({
        content: "test",
        usage_metadata: { input_tokens: 50, output_tokens: 25 },
      }),
    };

    mockModelService = {
      getLLM: vi.fn().mockReturnValue(mockLLM),
      getResolvedConfig: vi.fn().mockReturnValue(TEST_AI_CONFIG.ai),
    } as any;

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === "ai") return TEST_AI_CONFIG;
        return undefined;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LLMService,
        { provide: ModelService, useValue: mockModelService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: LLMCallDumper,
          useValue: mockDumper,
        },
        {
          provide: TokenUsageService,
          useValue: mockTokenUsageService,
        },
      ],
    }).compile();

    service = module.get<LLMService>(LLMService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("call", () => {
    const outputSchema = z.object({
      response: z.string(),
    });

    it("should call the LLM and return structured output", async () => {
      const result = await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(mockModelService.getLLM).toHaveBeenCalled();
      expect(mockLLM.withStructuredOutput).toHaveBeenCalledWith(outputSchema, { includeRaw: true });
      expect(result.response).toBe("test response");
      expect(result.tokenUsage.input).toBe(100);
      expect(result.tokenUsage.output).toBe(50);
    });

    it("should pass temperature to model service", async () => {
      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        temperature: 0.8,
      });

      expect(mockModelService.getLLM).toHaveBeenCalledWith({ temperature: 0.8, modelWeight: undefined });
    });

    it("should handle conversation history", async () => {
      const history = [
        { role: AgentMessageType.User, content: "Previous message" },
        { role: AgentMessageType.Assistant, content: "Previous response" },
      ];

      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        history,
      });

      expect(mockModelService.getLLM).toHaveBeenCalled();
    });

    it("should trim history when maxHistoryMessages is specified", async () => {
      const history = [
        { role: AgentMessageType.User, content: "Message 1" },
        { role: AgentMessageType.Assistant, content: "Response 1" },
        { role: AgentMessageType.User, content: "Message 2" },
        { role: AgentMessageType.Assistant, content: "Response 2" },
        { role: AgentMessageType.User, content: "Message 3" },
        { role: AgentMessageType.Assistant, content: "Response 3" },
      ];

      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        history,
        maxHistoryMessages: 2,
      });

      expect(mockModelService.getLLM).toHaveBeenCalled();
    });

    it("should validate input when validateInput is true and inputSchema is provided", async () => {
      const inputSchema = z.object({
        message: z.string().min(1),
      });

      await expect(
        service.call({
          inputParams: { message: "" },
          inputSchema,
          outputSchema,
          systemPrompts: ["You are a helpful assistant"],
          validateInput: true,
        }),
      ).rejects.toThrow("Invalid input parameters");
    });

    it("should skip validation when validateInput is false", async () => {
      const inputSchema = z.object({
        message: z.string().min(10),
      });

      // Should not throw even though message is shorter than 10 chars
      await service.call({
        inputParams: { message: "Hi" },
        inputSchema,
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        validateInput: false,
      });

      expect(mockModelService.getLLM).toHaveBeenCalled();
    });

    it("should use custom instructions when provided", async () => {
      await service.call({
        inputParams: { name: "Alice" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        instructions: "Say hello to {name}",
      });

      expect(mockModelService.getLLM).toHaveBeenCalled();
    });

    it("should auto-generate instructions when not provided", async () => {
      await service.call({
        inputParams: { name: "Alice", age: 30 },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(mockModelService.getLLM).toHaveBeenCalled();
    });

    it("should handle LLM parsing failure with fallback", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: null,
        raw: {
          usage_metadata: { input_tokens: 100, output_tokens: 50 },
          response_metadata: { finish_reason: "stop" },
          content: '{"response": "fallback parsed"}',
        },
      });

      const result = await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(result.response).toBe("fallback parsed");
    });

    it("should throw error when parsing and fallback both fail", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: null,
        raw: {
          usage_metadata: { input_tokens: 100, output_tokens: 50 },
          response_metadata: { finish_reason: "stop" },
          content: "invalid json",
        },
      });

      await expect(
        service.call({
          inputParams: { message: "Hello" },
          outputSchema,
          systemPrompts: ["You are a helpful assistant"],
        }),
      ).rejects.toThrow("LLM failed to return structured output");
    });

    it("should handle tools when provided", async () => {
      const mockTool = {
        name: "test_tool",
        description: "A test tool",
        schema: z.object({ input: z.string() }),
        invoke: vi.fn().mockResolvedValue("tool result"),
      };

      mockLLM.bindTools.mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          tool_calls: [],
          usage_metadata: { input_tokens: 50, output_tokens: 25 },
        }),
      });

      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        tools: [mockTool as any],
      });

      expect(mockLLM.bindTools).toHaveBeenCalledWith([mockTool]);
    });

    it("should handle errors from the LLM", async () => {
      mockStructuredLLM.invoke.mockRejectedValueOnce(new Error("LLM error"));

      await expect(
        service.call({
          inputParams: { message: "Hello" },
          outputSchema,
          systemPrompts: ["You are a helpful assistant"],
        }),
      ).rejects.toThrow("LLM service error: LLM error");
    });

    it("opens a dump session and closes it on success", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: { response: "ok" },
        raw: { usage_metadata: { input_tokens: 10, output_tokens: 5 } },
      });

      await service.call({
        systemPrompts: ["s"],
        inputParams: { q: "x" },
        outputSchema,
      });

      expect(startSessionMock).toHaveBeenCalledTimes(1);
      expect(closeMock).toHaveBeenCalledTimes(1);
      expect(closeMock.mock.calls[0][0].finalStatus).toBe("success");
    });

    it("records inputs once and one iteration per tool-loop pass", async () => {
      const aiMessageWithToolCall = {
        _getType: () => "ai",
        content: "",
        tool_calls: [{ id: "c1", name: "resolve_entity", args: { text: "x" } }],
        usage_metadata: { input_tokens: 100, output_tokens: 10 },
      };
      const aiMessageNoToolCalls = {
        _getType: () => "ai",
        content: "",
        tool_calls: [],
        usage_metadata: { input_tokens: 50, output_tokens: 5 },
      };
      const mockTool: any = {
        name: "resolve_entity",
        description: "d",
        schema: {},
        func: vi.fn().mockResolvedValue("tool-output"),
      };
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValueOnce(aiMessageWithToolCall).mockResolvedValueOnce(aiMessageNoToolCalls),
      });
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: { response: "ok" },
        raw: { usage_metadata: { input_tokens: 25, output_tokens: 3 } },
      });

      await service.call({
        systemPrompts: ["sys"],
        inputParams: { q: "x" },
        outputSchema,
        tools: [mockTool],
      });

      expect(recordInputsMock).toHaveBeenCalledTimes(1);
      // tool-loop iter 0, tool-loop iter 1, final-structured = 3 startIteration calls
      expect(startIterationMock).toHaveBeenCalledTimes(3);
      expect(startIterationMock.mock.calls[0][0]).toBe("tool-loop");
      expect(startIterationMock.mock.calls[1][0]).toBe("tool-loop");
      expect(startIterationMock.mock.calls[2][0]).toBe("final-structured");
      expect(recordToolResultMock).toHaveBeenCalledWith("c1", "resolve_entity", expect.any(String));
    });

    it("closes the dump session with finalStatus=error when call() throws", async () => {
      mockStructuredLLM.invoke.mockRejectedValueOnce(new Error("kaboom"));

      await expect(
        service.call({
          systemPrompts: ["s"],
          inputParams: { q: "x" },
          outputSchema,
        }),
      ).rejects.toThrow();

      expect(startSessionMock).toHaveBeenCalledTimes(1);
      expect(closeMock).toHaveBeenCalledTimes(1);
      expect(closeMock.mock.calls[0][0].finalStatus).toBe("error");
      expect(closeMock.mock.calls[0][0].errorMessage).toMatch(/kaboom/);
    });

    it("records the tool_calls parse fallback when the structured response is null but tool_calls.args is valid", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: null,
        raw: {
          content: "",
          usage_metadata: { input_tokens: 25, output_tokens: 3 },
          response_metadata: { finish_reason: "stop" },
          tool_calls: [{ args: { response: "ok" } }],
        },
      });

      await service.call({
        systemPrompts: ["s"],
        inputParams: { q: "x" },
        outputSchema,
      });

      expect(closeMock.mock.calls[0][0].parseFallbacks).toEqual(["tool_calls"]);
    });

    it("records a warning when totalTokens > 8000", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: { response: "ok" },
        raw: { usage_metadata: { input_tokens: 9000, output_tokens: 100 } },
      });

      await service.call({
        systemPrompts: ["s"],
        inputParams: { q: "x" },
        outputSchema,
      });

      const warnings = closeMock.mock.calls[0][0].warnings ?? [];
      expect(warnings.some((w: string) => /High token usage/.test(w))).toBe(true);
    });
  });

  describe("Gemini schema sanitization", () => {
    it("should sanitize schema for Gemini models via Requesty", async () => {
      // Update config to use Gemini model via Requesty
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "ai")
          return {
            ai: {
              provider: "requesty",
              model: "gemini-2.0-flash",
              apiKey: "test-key",
              url: "https://api.requesty.ai",
            },
          };
        return undefined;
      });

      const outputSchema = z.object({ response: z.string() });

      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      // Should still call withStructuredOutput (with sanitized schema)
      expect(mockLLM.withStructuredOutput).toHaveBeenCalled();
    });

    it("should not sanitize schema for non-Gemini models", async () => {
      const outputSchema = z.object({ response: z.string() });

      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      // Should call withStructuredOutput with the original Zod schema
      expect(mockLLM.withStructuredOutput).toHaveBeenCalledWith(outputSchema, { includeRaw: true });
    });
  });

  describe("private method behaviors (via call)", () => {
    it("should escape curly braces in auto-generated instructions", async () => {
      const outputSchema = z.object({ response: z.string() });

      // Object values should have braces escaped
      await service.call({
        inputParams: { data: { key: "value" } },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(mockModelService.getLLM).toHaveBeenCalled();
    });

    it("should convert different message types correctly", async () => {
      const outputSchema = z.object({ response: z.string() });

      const history = [
        { role: AgentMessageType.System, content: "System context" },
        { role: AgentMessageType.User, content: "User message" },
        { role: AgentMessageType.Assistant, content: "Assistant response" },
      ];

      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        history,
      });

      expect(mockModelService.getLLM).toHaveBeenCalled();
    });

    it("should handle null and undefined values in input params", async () => {
      const outputSchema = z.object({ response: z.string() });

      await service.call({
        inputParams: { nullValue: null, undefinedValue: undefined },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(mockModelService.getLLM).toHaveBeenCalled();
    });
  });

  describe("high token usage warning", () => {
    it("should log warning when token usage exceeds 8000", async () => {
      const consoleSpy = vi.spyOn(console, "warn");

      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: { response: "test response" },
        raw: {
          usage_metadata: {
            input_tokens: 5000,
            output_tokens: 4000,
          },
          response_metadata: { finish_reason: "stop" },
          content: '{"response": "test response"}',
        },
      });

      const outputSchema = z.object({ response: z.string() });

      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("High token usage detected"));
      consoleSpy.mockRestore();
    });
  });

  describe("token usage persistence", () => {
    const outputSchema = z.object({ response: z.string() });

    it("call() persists usage with the given type and the attributed relationship", async () => {
      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        tokenUsageType: "custom_node",
        relationshipId: "round-1",
        relationshipType: "Round",
        metadata: { nodeName: "narrator", agentName: "narrator" },
      });

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      const arg = recordTokenUsageMock.mock.calls[0][0];
      expect(arg.tokens).toEqual({ input: 100, output: 50 });
      expect(arg.type).toBe("custom_node");
      expect(arg.relationshipId).toBe("round-1");
      expect(arg.relationshipType).toBe("Round");
    });

    it("call() defaults the type to TextGeneration when none is given", async () => {
      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        relationshipId: "round-1",
        relationshipType: "Round",
      });

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].type).toBe(TokenUsageType.TextGeneration);
    });

    it("call() does NOT persist when no relationship is given (package stays domain-agnostic)", async () => {
      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(recordTokenUsageMock).not.toHaveBeenCalled();
    });

    it("call() does NOT throw when recordTokenUsage rejects", async () => {
      recordTokenUsageMock.mockRejectedValueOnce(new Error("db down"));

      const result = await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        relationshipId: "round-1",
        relationshipType: "Round",
      });

      expect(result.response).toBe("test response");
    });
  });

  describe("extractViaTool token tracking", () => {
    const toolSchema = z.object({ value: z.string() });

    beforeEach(() => {
      // bindTools returns an object whose invoke yields a tool call + real usage.
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          tool_calls: [{ name: "extract", args: { value: "ok" } }],
          content: "",
          usage_metadata: { input_tokens: 250, output_tokens: 80 },
        }),
      });
    });

    it("persists real tokens from usage_metadata (not 0/0) and forwards the type", async () => {
      await service.extractViaTool({
        systemPrompts: ["sys"],
        prompt: "extract this",
        tool: { name: "extract", description: "d", schema: toolSchema },
        tokenUsageType: "custom_extract",
        relationshipId: "g1",
        relationshipType: "Game",
        metadata: { nodeName: "extractor", agentName: "extractor" },
      });

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      const arg = recordTokenUsageMock.mock.calls[0][0];
      expect(arg.tokens).toEqual({ input: 250, output: 80 });
      expect(arg.type).toBe("custom_extract");
    });
  });

  describe("streamText observability", () => {
    function makeStreamResult(opts: { text?: Promise<string> | string; usage?: any; fail?: Error }) {
      const usage = opts.usage ?? { inputTokens: 30, outputTokens: 12 };
      return {
        text: opts.fail ? Promise.reject(opts.fail) : Promise.resolve(opts.text ?? "hello"),
        reasoningText: Promise.resolve(""),
        usage: Promise.resolve(usage),
        finishReason: Promise.resolve("stop"),
        fullStream: (async function* () {
          if (opts.fail) throw opts.fail;
          yield { type: "text-delta", text: "hello" };
        })(),
      };
    }

    it("persists usage with context after the stream completes", async () => {
      streamTextMock.mockReturnValue(makeStreamResult({ usage: { inputTokens: 30, outputTokens: 12 } }));

      const { result } = await service.streamText({
        systemPrompts: ["sys"],
        prompt: "go",
        tokenUsageType: "custom_narrate",
        relationshipId: "r7",
        relationshipType: "Round",
        metadata: { nodeName: "narrator", agentName: "narrator" },
      });

      await result;

      // streamText passes an abortSignal to the SDK.
      expect(streamTextMock.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      const arg = recordTokenUsageMock.mock.calls[0][0];
      expect(arg.tokens).toEqual({ input: 30, output: 12 });
      expect(arg.type).toBe("custom_narrate");
      expect(arg.relationshipId).toBe("r7");
      expect(arg.relationshipType).toBe("Round");
    });

    it("logs a WARN (does not swallow) when the underlying result rejects", async () => {
      const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      streamTextMock.mockReturnValue(makeStreamResult({ fail: new Error("upstream boom") }));

      const { result } = await service.streamText({
        systemPrompts: ["sys"],
        prompt: "go",
      });

      await expect(result).rejects.toThrow(/upstream boom/);
      // Let the attached .catch handler run.
      await new Promise((r) => setTimeout(r, 0));

      expect(warnSpy.mock.calls.some((c) => /streamText result rejected/.test(String(c[0])))).toBe(true);
      warnSpy.mockRestore();
    });
  });
});
