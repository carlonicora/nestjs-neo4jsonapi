import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { SummariserService } from "../summariser.service";
import { ModelService } from "../../../../core/llm/services/model.service";
import { Chunk } from "../../../../foundations/chunk/entities/chunk.entity";

/**
 * Regression guard for the config-driven summariser behaviour:
 *   - `summariser.emptySentinel` short-circuits the combine output and skips the tldr LLM call
 *   - `summariser.sanitizeTldr` strips markdown from the tldr
 *   - with NO `summariser` config the behaviour is byte-identical to the pre-config service
 */
describe("SummariserService — summariser config", () => {
  const TEST_IDS = {
    chunkId1: "550e8400-e29b-41d4-a716-446655440000",
  };

  const createMockChunks = (): Chunk[] => [
    {
      id: TEST_IDS.chunkId1,
      content: "This is the only chunk, about artificial intelligence and machine learning concepts.",
      position: 0,
      embedding: [],
    } as Chunk,
  ];

  const createMockLLMResponse = (content: string, inputTokens = 50, outputTokens = 25) => ({
    content,
    usage_metadata: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  });

  const mockLLM = { invoke: vi.fn() };

  const buildService = async (summariserConfig: unknown): Promise<SummariserService> => {
    const mockModelService = {
      getLLM: vi.fn().mockReturnValue(mockLLM),
      getEmbeddings: vi.fn(),
    };

    const mockConfigService = {
      get: vi.fn((key: string) => (key === "summariser" ? summariserConfig : undefined)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SummariserService,
        { provide: ModelService, useValue: mockModelService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    return module.get<SummariserService>(SummariserService);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLLM.invoke = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("emptySentinel", () => {
    it("returns empty content and tldr without invoking the tldr call when combine returns the sentinel", async () => {
      // Arrange
      const service = await buildService({ emptySentinel: "NO_SUMMARY" });

      mockLLM.invoke
        // map phase (1 chunk)
        .mockResolvedValueOnce(createMockLLMResponse("NO_SUMMARY", 40, 5))
        // combine phase
        .mockResolvedValueOnce(createMockLLMResponse("NO_SUMMARY", 60, 7));

      // Act
      const result = await service.summarise({ chunks: createMockChunks() });

      // Assert
      expect(result.content).toBe("");
      expect(result.tldr).toBe("");
      // 1 map + 1 combine, and NO tldr call
      expect(mockLLM.invoke).toHaveBeenCalledTimes(2);
      // tokens accumulated up to the short-circuit are still reported
      expect(result.tokens).toEqual({ input: 40 + 60, output: 5 + 7 });
    });

    it("matches the sentinel case-insensitively and ignores surrounding whitespace", async () => {
      // Arrange
      const service = await buildService({ emptySentinel: "NO_SUMMARY" });

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("no_summary"))
        .mockResolvedValueOnce(createMockLLMResponse("  no_summary\n"));

      // Act
      const result = await service.summarise({ chunks: createMockChunks() });

      // Assert
      expect(result.content).toBe("");
      expect(result.tldr).toBe("");
      expect(mockLLM.invoke).toHaveBeenCalledTimes(2);
    });

    it("does not short-circuit when the combine output merely contains the sentinel", async () => {
      // Arrange
      const service = await buildService({ emptySentinel: "NO_SUMMARY" });

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary"))
        .mockResolvedValueOnce(createMockLLMResponse("NO_SUMMARY was not appropriate here"))
        .mockResolvedValueOnce(createMockLLMResponse("A short tldr"));

      // Act
      const result = await service.summarise({ chunks: createMockChunks() });

      // Assert
      expect(result.content).toBe("NO_SUMMARY was not appropriate here");
      expect(result.tldr).toBe("A short tldr");
      expect(mockLLM.invoke).toHaveBeenCalledTimes(3);
    });

    it("does not short-circuit when no summariser config is provided", async () => {
      // Arrange
      const service = await buildService(undefined);

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary"))
        .mockResolvedValueOnce(createMockLLMResponse("NO_SUMMARY"))
        .mockResolvedValueOnce(createMockLLMResponse("A short tldr"));

      // Act
      const result = await service.summarise({ chunks: createMockChunks() });

      // Assert — unchanged legacy behaviour: the sentinel is just text
      expect(result.content).toBe("NO_SUMMARY");
      expect(result.tldr).toBe("A short tldr");
      expect(mockLLM.invoke).toHaveBeenCalledTimes(3);
    });
  });

  describe("sanitizeTldr", () => {
    it("strips markdown from the tldr when sanitizeTldr is enabled", async () => {
      // Arrange
      const service = await buildService({ sanitizeTldr: true });

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary"))
        .mockResolvedValueOnce(createMockLLMResponse("Combined summary"))
        .mockResolvedValueOnce(createMockLLMResponse("**Bold** _tldr_ with a [link](https://example.com)"));

      // Act
      const result = await service.summarise({ chunks: createMockChunks() });

      // Assert
      expect(result.tldr).toBe("Bold tldr with a link");
    });

    it("leaves the tldr untouched when no summariser config is provided", async () => {
      // Arrange
      const service = await buildService(undefined);

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary"))
        .mockResolvedValueOnce(createMockLLMResponse("Combined summary"))
        .mockResolvedValueOnce(createMockLLMResponse("**Bold** _tldr_ with a [link](https://example.com)"));

      // Act
      const result = await service.summarise({ chunks: createMockChunks() });

      // Assert — byte-identical to the pre-config behaviour
      expect(result.tldr).toBe("**Bold** _tldr_ with a [link](https://example.com)");
      expect(result.content).toBe("Combined summary");
    });

    it("leaves the tldr untouched when sanitizeTldr is explicitly false", async () => {
      // Arrange
      const service = await buildService({ sanitizeTldr: false });

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary"))
        .mockResolvedValueOnce(createMockLLMResponse("Combined summary"))
        .mockResolvedValueOnce(createMockLLMResponse("**Bold** tldr"));

      // Act
      const result = await service.summarise({ chunks: createMockChunks() });

      // Assert
      expect(result.tldr).toBe("**Bold** tldr");
    });
  });
});
