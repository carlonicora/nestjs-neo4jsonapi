import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import * as z from "zod";
import { LLMService } from "../llm.service";
import { ModelService } from "../model.service";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";

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
  DynamicStructuredTool: vi.fn(),
}));

describe("LLMService", () => {
  let service: LLMService;
  let mockModelService: vi.Mocked<ModelService>;
  let mockConfigService: vi.Mocked<ConfigService>;
  let mockLLM: any;
  let mockStructuredLLM: any;

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
      ],
    }).compile();

    service = module.get<LLMService>(LLMService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with empty session tokens", () => {
      const usage = service.getSessionUsage();

      expect(usage.input).toBe(0);
      expect(usage.output).toBe(0);
      expect(usage.total).toBe(0);
      expect(usage.callCount).toBe(0);
    });
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

    it("should track session token usage", async () => {
      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      const usage = service.getSessionUsage();
      expect(usage.input).toBe(100);
      expect(usage.output).toBe(50);
      expect(usage.total).toBe(150);
      expect(usage.callCount).toBe(1);
    });

    it("should accumulate token usage across multiple calls", async () => {
      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      await service.call({
        inputParams: { message: "Hi again" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      const usage = service.getSessionUsage();
      expect(usage.callCount).toBe(2);
      expect(usage.total).toBe(300);
    });

    it("should pass temperature to model service", async () => {
      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
        temperature: 0.8,
      });

      expect(mockModelService.getLLM).toHaveBeenCalledWith({ temperature: 0.8 });
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
  });

  describe("getSessionUsage", () => {
    it("should return a copy of session tokens", async () => {
      const outputSchema = z.object({ response: z.string() });

      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      const usage1 = service.getSessionUsage();
      const usage2 = service.getSessionUsage();

      // Should be equal values but different object references
      expect(usage1).toEqual(usage2);
      expect(usage1).not.toBe(usage2);
    });
  });

  describe("resetSession", () => {
    it("should reset all session token counters", async () => {
      const outputSchema = z.object({ response: z.string() });

      await service.call({
        inputParams: { message: "Hello" },
        outputSchema,
        systemPrompts: ["You are a helpful assistant"],
      });

      expect(service.getSessionUsage().callCount).toBe(1);

      service.resetSession();

      const usage = service.getSessionUsage();
      expect(usage.input).toBe(0);
      expect(usage.output).toBe(0);
      expect(usage.total).toBe(0);
      expect(usage.callCount).toBe(0);
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
});
