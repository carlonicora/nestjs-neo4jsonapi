import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as z from "zod";
import { LLMContentFilterError, LLMService, ToolLoopAbortError, contentFilterOutcome } from "../llm.service";
import { ModelService } from "../model.service";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";
import { LLMCallDumper } from "../llm-call-dumper.service";
import { TokenUsageService } from "../../../../foundations/tokenusage/services/tokenusage.service";
import { TokenUsageType } from "../../../../foundations/tokenusage/enums/tokenusage.type";
import { TOKEN_USAGE_RECORDER } from "../../../../common/tokens";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { repairTruncatedJson } from "../../utils/repair-truncated-json";

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

// The real repair behind a spy, so a test can prove a filtered answer never reaches it.
vi.mock("../../utils/repair-truncated-json", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/repair-truncated-json")>();
  return { ...actual, repairTruncatedJson: vi.fn(actual.repairTruncatedJson) };
});

describe("LLMService", () => {
  let service: LLMService;
  let mockModelService: Mocked<ModelService>;
  let mockConfigService: Mocked<ConfigService>;
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
      supportsStrictStructuredOutput: vi.fn().mockReturnValue(true),
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

      // objectContaining, not an exact match: every call now also carries its
      // per-attempt request budget (`timeoutMs`), which this test isn't about.
      expect(mockModelService.getLLM).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.8, modelWeight: undefined }),
      );
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

    // Regression: on the Azure Responses API surface (and Gemini) `raw.content` is an
    // array of content parts, not a string. The salvage ladder treats it as a string
    // (substring / JSON.parse / repairTruncatedJson / .length), so reading it raw threw
    // `TypeError: rawContent.substring is not a function` and killed the caller instead
    // of salvaging — it took out massima extraction across a whole corpus run.
    it("salvages from array content parts instead of throwing on substring", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: null,
        raw: {
          usage_metadata: { input_tokens: 100, output_tokens: 50 },
          response_metadata: { finish_reason: "stop" },
          content: [{ type: "text", text: '{"response": "salvaged from parts"}' }],
        },
      });

      const result = await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(result.response).toBe("salvaged from parts");
    });

    // Regression: Azure cuts the stream mid-value on moderated subject matter, leaving the
    // last array entry half-written. `repairTruncatedJson` closes the JSON, but a strict
    // parse then rejects the whole payload because that entry is missing required fields —
    // so every COMPLETE entry was binned with it, and the caller was marked failed. Drop the
    // partial entry and keep the rest. Shape taken from a real massima-extraction payload.
    it("keeps the complete entries when a truncated payload has one half-written entry", async () => {
      const massimaSchema = z.object({
        massime: z.array(
          z.object({
            type: z.string(),
            content: z.string(),
            referencedNorms: z.array(z.string()),
          }),
        ),
      });

      const truncated =
        '{"massime":[' +
        '{"type":"LEGAL_PRINCIPLE","content":"Prima massima completa.","referencedNorms":["art. 144-bis d.lgs. 196/2003"]},' +
        '{"type":"LEGAL_PRINCIPLE","content":"Seconda massima completa.","referencedNorms":["art. 6 GDPR"]},' +
        '{"type":"LEGAL_PRINCIPLE","content":"Terza massima tronc';

      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: null,
        raw: {
          usage_metadata: { input_tokens: 2247, output_tokens: 1211 },
          response_metadata: {},
          content: truncated,
        },
      });

      const result = await service.call({
        inputParams: { message: "Hello" },
        outputSchema: massimaSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(result.massime).toHaveLength(2);
      expect(result.massime[0].content).toBe("Prima massima completa.");
      expect(result.massime[1].content).toBe("Seconda massima completa.");
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

    it("salvages a MAX_TOKENS truncation instead of losing the whole response", async () => {
      // finish_reason "length" cuts the payload mid-value, so every JSON.parse
      // rung above rejects a response whose completed entries were fine.
      const listSchema = z.object({ facts: z.array(z.object({ text: z.string() })) });
      const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: null,
        raw: {
          usage_metadata: { input_tokens: 100, output_tokens: 50 },
          response_metadata: { finish_reason: "length" },
          content: '{"facts":[{"text":"one"},{"text":"two"},{"text":"thr',
        },
      });

      const result = await service.call({
        inputParams: { message: "Hello" },
        outputSchema: listSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(result.facts).toEqual([{ text: "one" }, { text: "two" }]);
      expect(warnSpy.mock.calls.some((c) => /truncation-repair/.test(String(c[0])))).toBe(true);
      warnSpy.mockRestore();
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

      expect(mockLLM.bindTools).toHaveBeenCalledWith([mockTool, expect.objectContaining({ name: "final_answer" })]);
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
      expect(arg.tokens).toEqual({ input: 100, output: 50, cached: 0 });
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

  // The seam that lets an application own the write path. `LLMModule` imports the
  // package `TokenUsageModule`, so `tokenUsageService` is ALWAYS the package
  // implementation no matter what an app aliases in its own module — an app that
  // subclasses it (a360ai: writes `pages`, deducts the company allowance) needs
  // this token to be reached at all.
  describe("token usage recorder seam (TOKEN_USAGE_RECORDER)", () => {
    const outputSchema = z.object({ response: z.string() });

    /** Builds LLMService with the same mocks, optionally binding the override token. */
    const buildService = async (recorder?: { recordTokenUsage: ReturnType<typeof vi.fn> }): Promise<LLMService> => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          LLMService,
          { provide: ModelService, useValue: mockModelService },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: LLMCallDumper, useValue: mockDumper },
          { provide: TokenUsageService, useValue: mockTokenUsageService },
          ...(recorder ? [{ provide: TOKEN_USAGE_RECORDER, useValue: recorder }] : []),
        ],
      }).compile();

      return module.get<LLMService>(LLMService);
    };

    it("writes through the override when TOKEN_USAGE_RECORDER is bound", async () => {
      const overrideRecord = vi.fn().mockResolvedValue(undefined);
      const overridden = await buildService({ recordTokenUsage: overrideRecord });

      await overridden.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        tokenUsageType: "graph_creator",
        relationshipId: "document-1",
        relationshipType: "Document",
      });

      expect(overrideRecord).toHaveBeenCalledTimes(1);
      const arg = overrideRecord.mock.calls[0][0];
      expect(arg.type).toBe("graph_creator");
      expect(arg.relationshipId).toBe("document-1");
      expect(arg.relationshipType).toBe("Document");
      expect(arg.tokens).toEqual({ input: 100, output: 50, cached: 0 });

      // The module-local service must NOT also be written to — a double write
      // would bill the same call twice.
      expect(recordTokenUsageMock).not.toHaveBeenCalled();
    });

    it("falls back to the module-local TokenUsageService when the token is absent", async () => {
      const plain = await buildService();

      await plain.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        tokenUsageType: "graph_creator",
        relationshipId: "document-1",
        relationshipType: "Document",
      });

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].type).toBe("graph_creator");
    });

    it("does NOT throw when the override rejects (persistence stays best-effort)", async () => {
      const overrideRecord = vi.fn().mockRejectedValue(new Error("db down"));
      const overridden = await buildService({ recordTokenUsage: overrideRecord });

      const result = await overridden.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        relationshipId: "document-1",
        relationshipType: "Document",
      });

      expect(result.response).toBe("test response");
      expect(overrideRecord).toHaveBeenCalledTimes(1);
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
      expect(arg.tokens).toEqual({ input: 250, output: 80, cached: 0 });
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
      expect(arg.tokens).toEqual({ input: 30, output: 12, cached: 0 });
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

  /**
   * A failed call is NOT a free call. The provider bills every round it already
   * served — a tool loop that times out on its final structured invocation has
   * been measured at six figures of input tokens — so each failure path records
   * what was actually burned before it threw.
   *
   * The one exception is a failure that consumed NOTHING (the provider was never
   * reached): recording it would write a record floored to `minCreditsPerRecord`,
   * i.e. invent a charge for tokens nobody spent.
   */
  describe("failure-path token billing", () => {
    const outputSchema = z.object({ response: z.string() });

    it("call() records the tokens burned before a failure", async () => {
      const tool: any = {
        name: "lookup",
        description: "looks things up",
        schema: z.object({ id: z.string() }),
        invoke: vi.fn().mockResolvedValue("{}"),
      };
      // Iteration 1 asks for a tool, iteration 2 answers in prose — both already
      // billed by the provider — and only then does the final structured
      // invocation blow up.
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi
          .fn()
          .mockResolvedValueOnce({
            content: "",
            tool_calls: [{ id: "c1", name: "lookup", args: { id: "npc-1" } }],
            usage_metadata: { input_tokens: 100_000, output_tokens: 500 },
          })
          .mockResolvedValueOnce({
            content: "draft",
            tool_calls: [],
            usage_metadata: { input_tokens: 2_000, output_tokens: 100 },
          }),
      });
      mockStructuredLLM.invoke.mockRejectedValueOnce(new Error("boom"));

      await expect(
        service.call({
          inputParams: { message: "Hello" },
          outputSchema,
          systemPrompts: ["You are a helpful assistant"],
          tools: [tool],
          tokenUsageType: "text_generation",
          relationshipId: "content-1",
          relationshipType: "Content",
        }),
      ).rejects.toThrow();

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          type: "text_generation",
          relationshipId: "content-1",
          relationshipType: "Content",
          tokens: { input: 102_000, output: 600, cached: 0 },
        }),
      );
    });

    it("call() still bills exactly once — not twice — when the same call succeeds", async () => {
      // Guards the split introduced for the failure path: the tool loop now
      // reports its own usage, so the final return must only add its delta.
      const tool: any = {
        name: "lookup",
        description: "looks things up",
        schema: z.object({ id: z.string() }),
        invoke: vi.fn().mockResolvedValue("{}"),
      };
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          content: "",
          tool_calls: [],
          usage_metadata: { input_tokens: 2_000, output_tokens: 100 },
        }),
      });

      const result = await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        tools: [tool],
        relationshipId: "content-1",
        relationshipType: "Content",
      });

      // 2000/100 from the single tool-loop turn + 100/50 from the structured call.
      expect(result.tokenUsage).toEqual({ input: 2_100, output: 150, cached: 0 });
      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 2_100, output: 150, cached: 0 });
    });

    it("call() records the unparseable answer the provider still charged for", async () => {
      // Every salvage attempt fails, so the call throws — but the generation
      // happened and was billed.
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: null,
        raw: {
          content: "not json at all",
          usage_metadata: { input_tokens: 800, output_tokens: 60 },
          response_metadata: { finish_reason: "length" },
        },
      });

      await expect(
        service.call({
          inputParams: { message: "Hello" },
          outputSchema,
          systemPrompts: ["You are a helpful assistant"],
          relationshipId: "content-1",
          relationshipType: "Content",
        }),
      ).rejects.toThrow(/failed to return structured output/);

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 800, output: 60, cached: 0 });
    });

    it("call() records NOTHING when the failure burned no tokens at all", async () => {
      // NOT a transient network error: those are retried (and a retry that
      // succeeds bills its success normally). A provider rejection is terminal.
      mockStructuredLLM.invoke.mockRejectedValueOnce(new Error("provider rejected the request"));

      await expect(
        service.call({
          inputParams: { message: "Hello" },
          outputSchema,
          systemPrompts: ["You are a helpful assistant"],
          relationshipId: "content-1",
          relationshipType: "Content",
        }),
      ).rejects.toThrow();

      expect(recordTokenUsageMock).not.toHaveBeenCalled();
    });

    // Regression: without `supportsStructuredOutputs` the openai-compatible SDK
    // degrades `responseFormat: {type:"json", schema}` to a bare
    // `{type:"json_object"}` and DROPS the schema. OpenAI/Azure then 400 the
    // request ("input messages must contain the word 'json'…") — observed live
    // on openai/gpt-5.x, tolerated by gemini.
    it("streamCall() asks the provider for schema-carrying structured output", async () => {
      streamObjectMock.mockReturnValue({
        object: Promise.resolve({ response: "ok" }),
        usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
        finishReason: Promise.resolve("stop"),
        partialObjectStream: (async function* () {})(),
      });

      const { result } = await service.streamCall({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["sys"],
      });
      await result;

      expect(createOpenAICompatible).toHaveBeenCalledWith(expect.objectContaining({ supportsStructuredOutputs: true }));
      // All-required schema → strict is satisfiable, so demand constrained decoding.
      expect(streamObjectMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerOptions: { openrouter: { strictJsonSchema: true } } }),
      );
    });

    it("streamCall() drops strict mode for a schema strict mode cannot express", async () => {
      streamObjectMock.mockReturnValue({
        object: Promise.resolve({ response: "ok" }),
        usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
        finishReason: Promise.resolve("stop"),
        partialObjectStream: (async function* () {})(),
      });

      const { result } = await service.streamCall({
        inputParams: { message: "Hello" },
        // `.optional()` keeps the field out of `required`, which strict mode
        // forbids — sending strict:true here would 400 the whole request.
        outputSchema: z.object({ response: z.string(), note: z.string().optional() }),
        systemPrompts: ["sys"],
      });
      await result;

      expect(streamObjectMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerOptions: { openrouter: { strictJsonSchema: false } } }),
      );
    });

    it("streamCall() records the usage that settled even though the object rejected", async () => {
      streamObjectMock.mockReturnValue({
        object: Promise.reject(new Error("stream blew up")),
        usage: Promise.resolve({ inputTokens: 900, outputTokens: 40 }),
        finishReason: Promise.resolve("error"),
        partialObjectStream: (async function* () {})(),
      });

      const { result } = await service.streamCall({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["sys"],
        tokenUsageType: "custom_stream",
        relationshipId: "r7",
        relationshipType: "Round",
      });

      await expect(result).rejects.toThrow(/stream blew up/);

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      const arg = recordTokenUsageMock.mock.calls[0][0];
      expect(arg.tokens).toEqual({ input: 900, output: 40, cached: 0 });
      expect(arg.type).toBe("custom_stream");
      // The dump session must report the same figures, not a hard-coded 0/0.
      expect(closeMock).toHaveBeenCalledWith(
        expect.objectContaining({ finalStatus: "error", totalTokens: { input: 900, output: 40, cached: 0 } }),
      );
    });

    it("streamText() records the usage that settled even though the text rejected", async () => {
      streamTextMock.mockReturnValue({
        text: Promise.reject(new Error("upstream boom")),
        reasoningText: Promise.resolve(""),
        usage: Promise.resolve({ inputTokens: 300, outputTokens: 20 }),
        finishReason: Promise.resolve("error"),
        fullStream: (async function* () {})(),
      });

      const { result } = await service.streamText({
        systemPrompts: ["sys"],
        prompt: "go",
        tokenUsageType: "custom_narrate",
        relationshipId: "r7",
        relationshipType: "Round",
      });

      await expect(result).rejects.toThrow(/upstream boom/);

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 300, output: 20, cached: 0 });
    });

    // The failure-path `usage` read must be BOUNDED. `result` runs under no outer
    // deadline (unlike `call()`, which runs inside `runBounded`), so an SDK that
    // rejects the content promise while leaving `usage` pending would turn a
    // prompt rejection into a caller that waits forever. Both tests below would
    // hang indefinitely against an unbounded `await streamResult.usage`.
    it("streamCall() still settles when usage never resolves", async () => {
      vi.useFakeTimers();
      try {
        streamObjectMock.mockReturnValue({
          object: Promise.reject(new Error("stream blew up")),
          // Never settles — neither resolved nor rejected.
          usage: new Promise(() => {}),
          finishReason: Promise.resolve("error"),
          partialObjectStream: (async function* () {})(),
        });

        const { result } = await service.streamCall({
          inputParams: { message: "Hello" },
          outputSchema,
          systemPrompts: ["sys"],
          relationshipId: "r7",
          relationshipType: "Round",
        });
        const settled = expect(result).rejects.toThrow(/stream blew up/);

        // Only the usage bound (2s) needs to elapse; the caller is not left waiting
        // on the provider's stalled promise.
        await vi.advanceTimersByTimeAsync(2_000);
        await settled;

        // Nothing is known to have been consumed, so nothing is billed.
        expect(recordTokenUsageMock).not.toHaveBeenCalled();
        expect(closeMock).toHaveBeenCalledWith(
          expect.objectContaining({ finalStatus: "error", totalTokens: { input: 0, output: 0, cached: 0 } }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("streamText() still settles when usage never resolves", async () => {
      vi.useFakeTimers();
      try {
        streamTextMock.mockReturnValue({
          text: Promise.reject(new Error("upstream boom")),
          reasoningText: Promise.resolve(""),
          usage: new Promise(() => {}),
          finishReason: Promise.resolve("error"),
          fullStream: (async function* () {})(),
        });

        const { result } = await service.streamText({
          systemPrompts: ["sys"],
          prompt: "go",
          relationshipId: "r7",
          relationshipType: "Round",
        });
        const settled = expect(result).rejects.toThrow(/upstream boom/);

        await vi.advanceTimersByTimeAsync(2_000);
        await settled;

        expect(recordTokenUsageMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("extractViaTool() records every attempt the provider served before it gave up", async () => {
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi
          .fn()
          .mockResolvedValueOnce({
            tool_calls: [],
            content: "I'm not able to help with that.",
            usage_metadata: { input_tokens: 250, output_tokens: 80 },
          })
          .mockResolvedValueOnce({
            tool_calls: [],
            content: "still no.",
            usage_metadata: { input_tokens: 100, output_tokens: 20 },
          }),
      });

      await expect(
        service.extractViaTool({
          systemPrompts: ["sys"],
          prompt: "extract this",
          tool: { name: "extract", description: "d", schema: z.object({ value: z.string() }) },
          tokenUsageType: "custom_extract",
          relationshipId: "g1",
          relationshipType: "Game",
        }),
      ).rejects.toThrow(/did not call the tool/);

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 350, output: 100, cached: 0 });
    });

    it("callStep() records usage on the success path when attribution is supplied", async () => {
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          content: "",
          tool_calls: [],
          usage_metadata: { input_tokens: 100, output_tokens: 40 },
        }),
      });

      await service.callStep({
        systemPrompts: ["sys"],
        messages: [],
        tools: [{ name: "do_thing", description: "d", schema: {} } as any],
        tokenUsageType: "operator_step",
        relationshipId: "op-1",
        relationshipType: "Operation",
      });

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      const arg = recordTokenUsageMock.mock.calls[0][0];
      expect(arg.tokens).toEqual({ input: 100, output: 40, cached: 0 });
      expect(arg.type).toBe("operator_step");
      expect(arg.relationshipId).toBe("op-1");
      expect(arg.relationshipType).toBe("Operation");
    });

    it("callStep() credits cached prompt tokens so a cache hit is not billed at the uncached rate", async () => {
      // The operator re-sends its whole conversation every step, so a prompt-cache
      // hit is the norm here. Dropping `cached` prices the ENTIRE prompt at the
      // uncached rate (`computeCost`) and over-bills every operator row.
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          content: "",
          tool_calls: [],
          usage_metadata: {
            input_tokens: 1000,
            output_tokens: 40,
            input_token_details: { cache_read: 900 },
          },
        }),
      });

      await service.callStep({
        systemPrompts: ["sys"],
        messages: [],
        tools: [{ name: "do_thing", description: "d", schema: {} } as any],
        tokenUsageType: "operator_step",
        relationshipId: "op-1",
        relationshipType: "Operation",
      });

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 1000, output: 40, cached: 900 });
    });

    it("callStep() exempts a zero-token SUCCESS from the credits floor", async () => {
      // A provider that answered but reported no usage at all. The call really
      // happened, so the row is written — but flooring it would invent a charge
      // for tokens nobody measured.
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({ content: "", tool_calls: [] }),
      });

      await service.callStep({
        systemPrompts: ["sys"],
        messages: [],
        tools: [{ name: "do_thing", description: "d", schema: {} } as any],
        tokenUsageType: "operator_step",
        relationshipId: "op-1",
        relationshipType: "Operation",
      });

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      const arg = recordTokenUsageMock.mock.calls[0][0];
      expect(arg.tokens).toEqual({ input: 0, output: 0, cached: 0 });
      expect(arg.applyMinimum).toBe(false);
    });

    it("callStep() keeps the credits floor on a token-bearing success", async () => {
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          content: "",
          tool_calls: [],
          usage_metadata: { input_tokens: 1, output_tokens: 0 },
        }),
      });

      await service.callStep({
        systemPrompts: ["sys"],
        messages: [],
        tools: [{ name: "do_thing", description: "d", schema: {} } as any],
        tokenUsageType: "operator_step",
        relationshipId: "op-1",
        relationshipType: "Operation",
      });

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].applyMinimum).toBeUndefined();
    });

    it("call() exempts a zero-token SUCCESS from the credits floor", async () => {
      mockStructuredLLM.invoke = vi.fn().mockResolvedValue({
        parsed: { response: "test response" },
        raw: { response_metadata: { finish_reason: "stop" }, content: '{"response": "test response"}' },
      });

      await service.call({
        inputParams: { message: "Hello" },
        outputSchema: z.object({ response: z.string() }),
        systemPrompts: ["sys"],
        tokenUsageType: "responder",
        relationshipId: "campaign-1",
        relationshipType: "Campaign",
      });

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      const arg = recordTokenUsageMock.mock.calls[0][0];
      expect(arg.tokens).toEqual({ input: 0, output: 0, cached: 0 });
      expect(arg.applyMinimum).toBe(false);
    });

    it("call() keeps the credits floor on a token-bearing success", async () => {
      await service.call({
        inputParams: { message: "Hello" },
        outputSchema: z.object({ response: z.string() }),
        systemPrompts: ["sys"],
        tokenUsageType: "responder",
        relationshipId: "campaign-1",
        relationshipType: "Campaign",
      });

      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].applyMinimum).toBeUndefined();
    });

    it("callStep() records nothing when the step failed without reaching the provider", async () => {
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockRejectedValue(new Error("model exploded")),
      });

      await expect(
        service.callStep({
          systemPrompts: ["sys"],
          messages: [],
          tools: [{ name: "do_thing", description: "d", schema: {} } as any],
          tokenUsageType: "operator_step",
          relationshipId: "op-1",
          relationshipType: "Operation",
        }),
      ).rejects.toThrow(/model exploded/);

      expect(recordTokenUsageMock).not.toHaveBeenCalled();
    });
  });

  /**
   * The four members of a tool the service reads: `name`, `description` and `schema` when it
   * records and binds the tools, `invoke` when the tool loop runs a call. A double typed with
   * it must have all four, and its `invoke` is a typed mock.
   */
  type ToolDouble = Mocked<Pick<DynamicStructuredTool, "name" | "description" | "schema" | "invoke">>;

  /** Hands tool doubles to `call()` and `callStep()`, whose `tools` parameter takes the whole class. */
  const asTools = (...doubles: ToolDouble[]): DynamicStructuredTool[] => doubles as unknown as DynamicStructuredTool[];

  /**
   * A refused answer is not a parse failure. The provider's content filter can refuse the
   * prompt (a thrown 400) or the output (a thrown error with no status, an incomplete
   * Responses API message, a refusal part, or the chat completions finish reason). All five
   * leave `call()` as one typed error, before the salvage ladder can repair a cut-off answer
   * into a shorter, clean-looking one.
   */
  describe("content filter outcomes (LLMContentFilterError)", () => {
    const outputSchema = z.object({ response: z.string() });
    const attributed = {
      inputParams: { message: "Hello" },
      outputSchema,
      systemPrompts: ["You are a helpful assistant"],
      tokenUsageType: "summary",
      relationshipId: "judgement-1",
      relationshipType: "Judgement",
    };
    const listSchema = z.object({ facts: z.array(z.object({ text: z.string() })) });
    // A cut-off payload the repair closes into a valid, shorter answer: the control test proves it.
    const CUT_OFF = '{"facts":[{"text":"one"},{"text":"two"},{"text":"thr';

    /** Resolves with the typed refusal the promise rejected with, and fails the test for anything else. */
    const refusalOf = async (promise: Promise<unknown>): Promise<LLMContentFilterError> => {
      const error = await promise.then(
        () => {
          throw new Error("expected the call to reject");
        },
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(LLMContentFilterError);
      if (!(error instanceof LLMContentFilterError)) throw error;
      return error;
    };

    it("re-exports the classifier and the error class from the service file", () => {
      expect(contentFilterOutcome({ response_metadata: { finish_reason: "content_filter" } })).toBe("output");
      expect(new LLMContentFilterError({ stage: "output", cause: undefined })).toBeInstanceOf(Error);
    });

    it.each([
      [
        "code content_filter",
        Object.assign(new Error("400 The response was filtered"), { status: 400, code: "content_filter" }),
      ],
      [
        "inner error ResponsibleAIPolicyViolation",
        Object.assign(new Error("400 Bad Request"), {
          status: 400,
          error: { innererror: { code: "ResponsibleAIPolicyViolation" } },
        }),
      ],
      [
        "content management policy message",
        Object.assign(
          new Error("The response was filtered due to the prompt triggering the content management policy."),
          { status: 400 },
        ),
      ],
    ])("shape 1 (%s): a thrown 400 leaves as a prompt refusal, not wrapped", async (_label, providerError) => {
      mockStructuredLLM.invoke.mockRejectedValueOnce(providerError);

      const error = await refusalOf(service.call(attributed));

      expect(error.stage).toBe("prompt");
      expect(error.cause).toBe(providerError);
      expect(error.message).not.toMatch(/^LLM service error:/);
      expect(mockStructuredLLM.invoke).toHaveBeenCalledTimes(1);
      expect(closeMock).toHaveBeenCalledWith(expect.objectContaining({ finalStatus: "error" }));
      // Nothing was generated, so nothing is billed: the zero-token rule holds as before.
      expect(recordTokenUsageMock).not.toHaveBeenCalled();
    });

    it("shape 1: the tokens burned before the refusal are recorded as before", async () => {
      const tool: ToolDouble = {
        name: "lookup",
        description: "looks things up",
        schema: z.object({ id: z.string() }),
        invoke: vi.fn().mockResolvedValue("{}"),
      };
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValueOnce({
          content: "draft",
          tool_calls: [],
          usage_metadata: { input_tokens: 2_000, output_tokens: 100 },
        }),
      });
      mockStructuredLLM.invoke.mockRejectedValueOnce(
        Object.assign(new Error("400 The response was filtered"), { status: 400, code: "content_filter" }),
      );

      const error = await refusalOf(service.call({ ...attributed, tools: asTools(tool) }));

      expect(error.stage).toBe("prompt");
      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          type: "summary",
          relationshipId: "judgement-1",
          relationshipType: "Judgement",
          tokens: { input: 2_000, output: 100, cached: 0 },
        }),
      );
    });

    it("shape 2: a thrown content_filter error with no status leaves as an output refusal", async () => {
      const providerError = Object.assign(new Error("The response was filtered"), { name: "content_filter" });
      mockStructuredLLM.invoke.mockRejectedValueOnce(providerError);

      const error = await refusalOf(service.call(attributed));

      expect(error.stage).toBe("output");
      expect(error.cause).toBe(providerError);
      expect(error.message).not.toMatch(/^LLM service error:/);
    });

    it("shape 3: an incomplete filtered answer never reaches the JSON repair, and its tokens are recorded", async () => {
      const raw = {
        usage_metadata: { input_tokens: 800, output_tokens: 60 },
        response_metadata: { status: "incomplete", incomplete_details: { reason: "content_filter" } },
        content: CUT_OFF,
      };
      mockStructuredLLM.invoke.mockResolvedValueOnce({ parsed: null, raw });

      const error = await refusalOf(service.call({ ...attributed, outputSchema: listSchema }));

      expect(error.stage).toBe("output");
      expect(error.cause).toBe(raw);
      expect(error.message).not.toMatch(/^LLM service error:/);
      expect(repairTruncatedJson).not.toHaveBeenCalled();
      expect(mockStructuredLLM.invoke).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 800, output: 60, cached: 0 });
      expect(closeMock).toHaveBeenCalledWith(
        expect.objectContaining({ finalStatus: "error", totalTokens: { input: 800, output: 60, cached: 0 } }),
      );
    });

    it("shape 3: a filtered answer is refused even when the wrapper returned a parsed value", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: { response: "Una sintesi" },
        raw: {
          usage_metadata: { input_tokens: 800, output_tokens: 60 },
          response_metadata: { status: "incomplete", incomplete_details: { reason: "content_filter" } },
          content: '{"response":"Una sintesi"}',
        },
      });

      const error = await refusalOf(service.call(attributed));

      expect(error.stage).toBe("output");
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 800, output: 60, cached: 0 });
    });

    it("shape 4: a refusal part with no parsed value leaves as an output refusal", async () => {
      const raw = {
        usage_metadata: { input_tokens: 500, output_tokens: 12 },
        response_metadata: { status: "completed" },
        additional_kwargs: { refusal: "I cannot help with that." },
        content: "",
      };
      mockStructuredLLM.invoke.mockResolvedValueOnce({ parsed: null, raw });

      const error = await refusalOf(service.call(attributed));

      expect(error.stage).toBe("output");
      expect(error.cause).toBe(raw);
      expect(repairTruncatedJson).not.toHaveBeenCalled();
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 500, output: 12, cached: 0 });
    });

    it("shape 4: a refusal part beside a parsed value is not a refusal", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: { response: "ok" },
        raw: {
          usage_metadata: { input_tokens: 500, output_tokens: 12 },
          response_metadata: { status: "completed" },
          additional_kwargs: { refusal: "I cannot help with that." },
          content: '{"response":"ok"}',
        },
      });

      const result = await service.call(attributed);

      expect(result.response).toBe("ok");
    });

    it("shape 5: finish_reason content_filter leaves as an output refusal before the repair", async () => {
      const raw = {
        usage_metadata: { input_tokens: 700, output_tokens: 45 },
        response_metadata: { finish_reason: "content_filter" },
        content: CUT_OFF,
      };
      mockStructuredLLM.invoke.mockResolvedValueOnce({ parsed: null, raw });

      const error = await refusalOf(service.call({ ...attributed, outputSchema: listSchema }));

      expect(error.stage).toBe("output");
      expect(error.cause).toBe(raw);
      expect(repairTruncatedJson).not.toHaveBeenCalled();
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 700, output: 45, cached: 0 });
    });

    it("control: a length truncation still reaches the JSON repair", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: null,
        raw: {
          usage_metadata: { input_tokens: 700, output_tokens: 45 },
          response_metadata: { finish_reason: "length" },
          content: CUT_OFF,
        },
      });

      const result = await service.call({ ...attributed, outputSchema: listSchema });

      expect(result.facts).toEqual([{ text: "one" }, { text: "two" }]);
      expect(repairTruncatedJson).toHaveBeenCalledTimes(1);
    });

    it("streamCall() rejects with the typed error when the stream ends on the content filter", async () => {
      streamObjectMock.mockReturnValue({
        object: Promise.resolve({ response: "Una sintesi" }),
        usage: Promise.resolve({ inputTokens: 900, outputTokens: 40 }),
        // The Vercel AI SDK spelling of the provider's content_filter.
        finishReason: Promise.resolve("content-filter"),
        partialObjectStream: (async function* () {})(),
      });

      const { result } = await service.streamCall({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["sys"],
        tokenUsageType: "custom_stream",
        relationshipId: "r7",
        relationshipType: "Round",
      });
      const error = await refusalOf(result);

      expect(error.stage).toBe("output");
      expect(error.message).not.toMatch(/^LLM streamCall error:/);
      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 900, output: 40, cached: 0 });
      expect(closeMock).toHaveBeenCalledTimes(1);
      expect(closeMock).toHaveBeenCalledWith(
        expect.objectContaining({ finalStatus: "error", totalTokens: { input: 900, output: 40, cached: 0 } }),
      );
    });

    it("streamText() rejects with the typed error when the stream ends on the content filter", async () => {
      streamTextMock.mockReturnValue({
        text: Promise.resolve("Una sintesi"),
        reasoningText: Promise.resolve(""),
        usage: Promise.resolve({ inputTokens: 300, outputTokens: 20 }),
        finishReason: Promise.resolve("content-filter"),
        fullStream: (async function* () {})(),
      });

      const { result } = await service.streamText({
        systemPrompts: ["sys"],
        prompt: "go",
        tokenUsageType: "custom_narrate",
        relationshipId: "r7",
        relationshipType: "Round",
      });
      const error = await refusalOf(result);

      expect(error.stage).toBe("output");
      expect(error.message).not.toMatch(/^LLM streamText error:/);
      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0].tokens).toEqual({ input: 300, output: 20, cached: 0 });
      expect(closeMock).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The Responses API carries no `finish_reason`: the reason a response ended is in
   * `incomplete_details.reason`, and failing that in `status`. Logs and dumps read the three
   * in that order.
   */
  describe("finish reason written to logs and dumps", () => {
    const outputSchema = z.object({ response: z.string() });
    const base = { inputParams: { message: "Hello" }, outputSchema, systemPrompts: ["sys"] };

    it("reads incomplete_details.reason when there is no finish_reason", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: { response: "ok" },
        raw: {
          usage_metadata: { input_tokens: 10, output_tokens: 5 },
          response_metadata: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
          content: '{"response":"ok"}',
        },
      });

      await service.call(base);

      expect(recordResponseMock).toHaveBeenCalledWith(expect.objectContaining({ finishReason: "max_output_tokens" }));
    });

    it("reads status when there is neither finish_reason nor incomplete_details", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: { response: "ok" },
        raw: {
          usage_metadata: { input_tokens: 10, output_tokens: 5 },
          response_metadata: { status: "completed" },
          content: '{"response":"ok"}',
        },
      });

      await service.call(base);

      expect(recordResponseMock).toHaveBeenCalledWith(expect.objectContaining({ finishReason: "completed" }));
    });

    it("prefers finish_reason over the other two", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: { response: "ok" },
        raw: {
          usage_metadata: { input_tokens: 10, output_tokens: 5 },
          response_metadata: {
            finish_reason: "stop",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
          },
          content: '{"response":"ok"}',
        },
      });

      await service.call(base);

      expect(recordResponseMock).toHaveBeenCalledWith(expect.objectContaining({ finishReason: "stop" }));
    });

    it("names the Responses API reason in the structured output failure", async () => {
      mockStructuredLLM.invoke.mockResolvedValueOnce({
        parsed: null,
        raw: {
          usage_metadata: { input_tokens: 10, output_tokens: 5 },
          response_metadata: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
          content: "not json at all",
        },
      });

      await expect(service.call(base)).rejects.toThrow(/Finish reason: max_output_tokens\./);
    });

    it("reads the same order for a tool loop response", async () => {
      const tool: ToolDouble = {
        name: "lookup",
        description: "looks things up",
        schema: z.object({ id: z.string() }),
        invoke: vi.fn().mockResolvedValue("{}"),
      };
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValueOnce({
          content: "draft",
          tool_calls: [],
          usage_metadata: { input_tokens: 50, output_tokens: 25 },
          response_metadata: { status: "completed" },
        }),
      });

      await service.call({ ...base, tools: asTools(tool) });

      expect(recordResponseMock.mock.calls[0][0].finishReason).toBe("completed");
    });

    it("reads the same order in callStep()", async () => {
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          content: "",
          tool_calls: [],
          usage_metadata: { input_tokens: 100, output_tokens: 40 },
          response_metadata: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
        }),
      });

      await service.callStep({
        systemPrompts: ["sys"],
        messages: [],
        tools: asTools({ name: "do_thing", description: "d", schema: {}, invoke: vi.fn() }),
      });

      expect(recordResponseMock).toHaveBeenCalledWith(expect.objectContaining({ finishReason: "max_output_tokens" }));
    });

    it("reads the same order in the extractViaTool() diagnostic", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          tool_calls: [],
          content: "no tool call",
          usage_metadata: { input_tokens: 10, output_tokens: 5 },
          response_metadata: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
        }),
      });

      await expect(
        service.extractViaTool({
          systemPrompts: ["sys"],
          prompt: "extract this",
          tool: { name: "extract", description: "d", schema: z.object({ value: z.string() }) },
        }),
      ).rejects.toThrow(/did not call the tool/);

      expect(errorSpy.mock.calls.some((c) => /finish_reason=max_output_tokens /.test(String(c[0])))).toBe(true);
      errorSpy.mockRestore();
    });
  });

  /**
   * A tool can stop the run. Any other throw from a tool is answered to the model as a
   * ToolMessage, so a dependency that is down costs one billed model round per retry the
   * model decides to make. A `ToolLoopAbortError` leaves the loop and reaches the caller
   * as the same instance.
   */
  describe("tool loop abort (ToolLoopAbortError)", () => {
    const outputSchema = z.object({ response: z.string() });
    const attributed = {
      inputParams: { message: "Hello" },
      outputSchema,
      systemPrompts: ["You are a helpful assistant"],
      tokenUsageType: "legal_research",
      relationshipId: "research-1",
      relationshipType: "LegalResearch",
    };
    const searchSchema = z.object({ query: z.string() });

    it("carries the message and the cause", () => {
      const cause = new Error("connect ECONNREFUSED 10.0.0.5:3403");

      const error = new ToolLoopAbortError({ message: "corpus down", cause });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ToolLoopAbortError);
      expect(error.name).toBe("ToolLoopAbortError");
      expect(error.message).toBe("corpus down");
      expect(error.cause).toBe(cause);
    });

    // Review focus 5.
    it("leaves the loop as the same instance, after the usage of the calls already made is persisted", async () => {
      // A cause the transient retry would otherwise read as "try the whole call again".
      const cause = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:3403"), { code: "ECONNREFUSED" });
      const abort = new ToolLoopAbortError({ message: "corpus down", cause });
      const tool: ToolDouble = {
        name: "search_massime",
        description: "searches the massime",
        schema: searchSchema,
        invoke: vi.fn().mockResolvedValueOnce("[]").mockRejectedValueOnce(abort),
      };
      const boundInvoke = vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [{ id: "c1", name: "search_massime", args: { query: "art. 2043 c.c." } }],
          usage_metadata: { input_tokens: 1_000, output_tokens: 40 },
        })
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [{ id: "c2", name: "search_massime", args: { query: "danno ingiusto" } }],
          usage_metadata: { input_tokens: 1_500, output_tokens: 60 },
        });
      mockLLM.bindTools = vi.fn().mockReturnValue({ invoke: boundInvoke });
      const order: string[] = [];
      recordTokenUsageMock.mockImplementationOnce(async () => {
        order.push("usage persisted");
      });

      const caught = await service.call({ ...attributed, tools: asTools(tool) }).then(
        () => undefined,
        (error: unknown) => {
          order.push("rejected");
          return error;
        },
      );

      expect(caught).toBe(abort);
      expect(order).toEqual(["usage persisted", "rejected"]);
      // Both model rounds were served and billed before the tool stopped the run.
      expect(recordTokenUsageMock).toHaveBeenCalledTimes(1);
      expect(recordTokenUsageMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          type: "legal_research",
          relationshipId: "research-1",
          relationshipType: "LegalResearch",
          tokens: { input: 2_500, output: 100, cached: 0 },
        }),
      );
      // The model is not called again: no third round, no structured round, no retry of the call.
      expect(boundInvoke).toHaveBeenCalledTimes(2);
      expect(tool.invoke).toHaveBeenCalledTimes(2);
      expect(mockStructuredLLM.invoke).not.toHaveBeenCalled();
      expect(mockModelService.getLLM).toHaveBeenCalledTimes(1);
      expect(closeMock).toHaveBeenCalledTimes(1);
      expect(closeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          finalStatus: "error",
          errorMessage: "corpus down",
          totalTokens: { input: 2_500, output: 100, cached: 0 },
        }),
      );
    });

    it("does not run the tool calls that follow the abort in the same round, and answers nothing to the model", async () => {
      const abort = new ToolLoopAbortError({ message: "corpus down", cause: new Error("503") });
      const failing: ToolDouble = {
        name: "search_massime",
        description: "searches the massime",
        schema: searchSchema,
        invoke: vi.fn().mockRejectedValue(abort),
      };
      const following: ToolDouble = {
        name: "search_judgements",
        description: "searches the judgements",
        schema: searchSchema,
        invoke: vi.fn().mockResolvedValue("[]"),
      };
      mockLLM.bindTools = vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValueOnce({
          content: "",
          tool_calls: [
            { id: "c1", name: "search_massime", args: { query: "art. 2043 c.c." } },
            { id: "c2", name: "search_judgements", args: { query: "art. 2043 c.c." } },
          ],
          usage_metadata: { input_tokens: 1_000, output_tokens: 40 },
        }),
      });

      await expect(service.call({ ...attributed, tools: asTools(failing, following) })).rejects.toBe(abort);

      expect(following.invoke).not.toHaveBeenCalled();
      expect(recordToolResultMock).not.toHaveBeenCalled();
    });

    it("still answers any other tool error to the model", async () => {
      const tool: ToolDouble = {
        name: "search_massime",
        description: "searches the massime",
        schema: searchSchema,
        invoke: vi.fn().mockRejectedValueOnce(new Error("boom")),
      };
      const boundInvoke = vi
        .fn()
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [{ id: "c1", name: "search_massime", args: { query: "art. 2043 c.c." } }],
          usage_metadata: { input_tokens: 1_000, output_tokens: 40 },
        })
        .mockResolvedValueOnce({
          content: "draft",
          tool_calls: [],
          usage_metadata: { input_tokens: 1_200, output_tokens: 30 },
        });
      mockLLM.bindTools = vi.fn().mockReturnValue({ invoke: boundInvoke });

      const result = await service.call({ ...attributed, tools: asTools(tool) });

      expect(result.response).toBe("test response");
      expect(recordToolResultMock).toHaveBeenCalledWith("c1", "search_massime", "Tool error: boom");
      expect(boundInvoke).toHaveBeenCalledTimes(2);
      expect(mockStructuredLLM.invoke).toHaveBeenCalledTimes(1);
    });
  });
});
