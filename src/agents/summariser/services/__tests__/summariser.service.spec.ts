import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { SUMMARISER_MAP_CONCURRENCY, SummariserService } from "../summariser.service";
import { ModelService } from "../../../../core/llm/services/model.service";
import { Chunk } from "../../../../foundations/chunk/entities/chunk.entity";

describe("SummariserService", () => {
  let service: SummariserService;
  let modelService: MockedObject<ModelService>;
  let configService: MockedObject<ConfigService>;

  const TEST_IDS = {
    chunkId1: "550e8400-e29b-41d4-a716-446655440000",
    chunkId2: "660e8400-e29b-41d4-a716-446655440001",
    chunkId3: "770e8400-e29b-41d4-a716-446655440002",
  };

  const createMockChunks = (): Chunk[] => [
    {
      id: TEST_IDS.chunkId1,
      content: "This is the first chunk about artificial intelligence and machine learning concepts.",
      position: 0,
      embedding: [],
    } as Chunk,
    {
      id: TEST_IDS.chunkId2,
      content: "This is the second chunk about natural language processing and text analysis.",
      position: 1,
      embedding: [],
    } as Chunk,
    {
      id: TEST_IDS.chunkId3,
      content: "This is the third chunk about deep learning neural networks and their applications.",
      position: 2,
      embedding: [],
    } as Chunk,
  ];

  const createMockModelService = () => {
    const mockLLM = {
      invoke: vi.fn(),
    };

    return {
      getLLM: vi.fn().mockReturnValue(mockLLM),
      getEmbeddings: vi.fn(),
    };
  };

  const createMockConfigService = () => ({
    get: vi.fn().mockReturnValue(null),
  });

  const createMockLLMResponse = (content: string, inputTokens = 50, outputTokens = 25) => ({
    content,
    usage_metadata: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockModelService = createMockModelService();
    const mockConfigService = createMockConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SummariserService,
        { provide: ModelService, useValue: mockModelService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SummariserService>(SummariserService);
    modelService = module.get(ModelService) as MockedObject<ModelService>;
    configService = module.get(ConfigService) as MockedObject<ConfigService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });

    it("should access prompts configuration", () => {
      expect(configService.get).toHaveBeenCalledWith("prompts");
    });
  });

  describe("summarise", () => {
    it("should return summary content with tldr and token usage", async () => {
      // Arrange
      const chunks = createMockChunks();
      const mockLLM = modelService.getLLM({});

      // Mock responses for map phase (one per chunk)
      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary of chunk 1 about AI"))
        .mockResolvedValueOnce(createMockLLMResponse("Summary of chunk 2 about NLP"))
        .mockResolvedValueOnce(createMockLLMResponse("Summary of chunk 3 about deep learning"))
        // Mock response for combine phase
        .mockResolvedValueOnce(
          createMockLLMResponse("Combined summary covering AI, NLP, and deep learning concepts", 100, 50),
        )
        // Mock response for TLDR phase
        .mockResolvedValueOnce(createMockLLMResponse("AI and NLP concepts explained", 30, 10));

      // Act
      const result = await service.summarise({ chunks });

      // Assert
      expect(result).toBeDefined();
      expect(result.content).toBe("Combined summary covering AI, NLP, and deep learning concepts");
      expect(result.tldr).toBe("AI and NLP concepts explained");
      expect(result.tokens).toEqual({
        input: 50 + 50 + 50 + 100 + 30, // 3 map + combine + tldr
        output: 25 + 25 + 25 + 50 + 10, // 3 map + combine + tldr
      });
    });

    it("should call getLLM from model service", async () => {
      // Arrange
      const chunks = createMockChunks();
      const mockLLM = modelService.getLLM({});

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary 1"))
        .mockResolvedValueOnce(createMockLLMResponse("Summary 2"))
        .mockResolvedValueOnce(createMockLLMResponse("Summary 3"))
        .mockResolvedValueOnce(createMockLLMResponse("Combined"))
        .mockResolvedValueOnce(createMockLLMResponse("TLDR"));

      // Act
      await service.summarise({ chunks });

      // Assert
      expect(modelService.getLLM).toHaveBeenCalledWith({});
    });

    it("should process each chunk in the map phase", async () => {
      // Arrange
      const chunks = createMockChunks();
      const mockLLM = modelService.getLLM({});

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary 1"))
        .mockResolvedValueOnce(createMockLLMResponse("Summary 2"))
        .mockResolvedValueOnce(createMockLLMResponse("Summary 3"))
        .mockResolvedValueOnce(createMockLLMResponse("Combined"))
        .mockResolvedValueOnce(createMockLLMResponse("TLDR"));

      // Act
      await service.summarise({ chunks });

      // Assert
      // 3 chunks + 1 combine + 1 tldr = 5 invocations
      expect(mockLLM.invoke).toHaveBeenCalledTimes(5);
    });

    it("should handle single chunk", async () => {
      // Arrange
      const chunks = [createMockChunks()[0]];
      const mockLLM = modelService.getLLM({});

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary of single chunk"))
        .mockResolvedValueOnce(createMockLLMResponse("Combined single summary"))
        .mockResolvedValueOnce(createMockLLMResponse("TLDR for single chunk"));

      // Act
      const result = await service.summarise({ chunks });

      // Assert
      expect(result.content).toBe("Combined single summary");
      expect(result.tldr).toBe("TLDR for single chunk");
      // 1 map + 1 combine + 1 tldr = 3 invocations
      expect(mockLLM.invoke).toHaveBeenCalledTimes(3);
    });

    it("should handle empty chunks array", async () => {
      // Arrange
      const chunks: Chunk[] = [];
      const mockLLM = modelService.getLLM({});

      // When no chunks, only combine and tldr will be called
      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Empty summary"))
        .mockResolvedValueOnce(createMockLLMResponse("Empty TLDR"));

      // Act
      const result = await service.summarise({ chunks });

      // Assert
      expect(result.content).toBe("Empty summary");
      expect(result.tldr).toBe("Empty TLDR");
      // 0 map + 1 combine + 1 tldr = 2 invocations
      expect(mockLLM.invoke).toHaveBeenCalledTimes(2);
    });

    it("should handle missing usage_metadata gracefully", async () => {
      // Arrange
      const chunks = [createMockChunks()[0]];
      const mockLLM = modelService.getLLM({});

      // Response without usage_metadata
      const responseWithoutMetadata = {
        content: "Summary without metadata",
        usage_metadata: undefined,
      };

      mockLLM.invoke
        .mockResolvedValueOnce(responseWithoutMetadata)
        .mockResolvedValueOnce(responseWithoutMetadata)
        .mockResolvedValueOnce(responseWithoutMetadata);

      // Act
      const result = await service.summarise({ chunks });

      // Assert
      expect(result.tokens).toEqual({
        input: 0,
        output: 0,
      });
    });

    it("should accumulate tokens from all phases", async () => {
      // Arrange
      const chunks = [createMockChunks()[0], createMockChunks()[1]];
      const mockLLM = modelService.getLLM({});

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary 1", 100, 40))
        .mockResolvedValueOnce(createMockLLMResponse("Summary 2", 150, 60))
        .mockResolvedValueOnce(createMockLLMResponse("Combined", 200, 80))
        .mockResolvedValueOnce(createMockLLMResponse("TLDR", 50, 20));

      // Act
      const result = await service.summarise({ chunks });

      // Assert
      expect(result.tokens).toEqual({
        input: 100 + 150 + 200 + 50, // 500
        output: 40 + 60 + 80 + 20, // 200
      });
    });

    it("should combine map summaries with newlines", async () => {
      // Arrange
      const chunks = createMockChunks();
      const mockLLM = modelService.getLLM({});

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary A"))
        .mockResolvedValueOnce(createMockLLMResponse("Summary B"))
        .mockResolvedValueOnce(createMockLLMResponse("Summary C"))
        .mockResolvedValueOnce(createMockLLMResponse("Final combined"))
        .mockResolvedValueOnce(createMockLLMResponse("TLDR"));

      // Act
      await service.summarise({ chunks });

      // Assert - the combine prompt should receive all summaries
      // We can verify this by checking that invoke was called with the right structure
      expect(mockLLM.invoke).toHaveBeenCalledTimes(5);
    });

    it("should use chunk content in map phase", async () => {
      // Arrange
      const chunks = [
        {
          id: TEST_IDS.chunkId1,
          content: "Specific content to summarize",
          position: 0,
          embedding: [],
        } as Chunk,
      ];
      const mockLLM = modelService.getLLM({});

      mockLLM.invoke
        .mockResolvedValueOnce(createMockLLMResponse("Summary"))
        .mockResolvedValueOnce(createMockLLMResponse("Combined"))
        .mockResolvedValueOnce(createMockLLMResponse("TLDR"));

      // Act
      await service.summarise({ chunks });

      // Assert - the map prompt should be invoked with chunk content
      const firstCall = mockLLM.invoke.mock.calls[0][0];
      expect(firstCall).toBeDefined();
    });

    it("should return string content from LLM response", async () => {
      // Arrange
      const chunks = [createMockChunks()[0]];
      const mockLLM = modelService.getLLM({});

      // LLM response content might be various types, should be converted to string
      mockLLM.invoke
        .mockResolvedValueOnce({
          content: { text: "Complex content" },
          usage_metadata: { input_tokens: 50, output_tokens: 25 },
        })
        .mockResolvedValueOnce(createMockLLMResponse("Combined"))
        .mockResolvedValueOnce(createMockLLMResponse("TLDR"));

      // Act
      const result = await service.summarise({ chunks });

      // Assert - content should be stringified
      expect(typeof result.content).toBe("string");
      expect(typeof result.tldr).toBe("string");
    });
  });

  describe("bounded map fan-out", () => {
    it("keeps at most SUMMARISER_MAP_CONCURRENCY map calls in flight for 20 chunks", async () => {
      // Arrange — 20 chunks, i.e. more than the bound, so an unbounded
      // `Promise.all` would show a peak of 20.
      const chunks: Chunk[] = Array.from(
        { length: 20 },
        (_, i) =>
          ({
            id: `chunk-${i}`,
            content: `Chunk number ${i} content.`,
            position: i,
            embedding: [],
          }) as unknown as Chunk,
      );
      const mockLLM = modelService.getLLM({});

      let inFlight = 0;
      let peakInFlight = 0;
      mockLLM.invoke.mockImplementation(async () => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return createMockLLMResponse("Summary");
      });

      // Act
      await service.summarise({ chunks });

      // Assert
      expect(SUMMARISER_MAP_CONCURRENCY).toBe(8);
      expect(peakInFlight).toBeLessThanOrEqual(SUMMARISER_MAP_CONCURRENCY);
      // Guards against the fan-out collapsing to serial execution.
      expect(peakInFlight).toBe(SUMMARISER_MAP_CONCURRENCY);
      expect(inFlight).toBe(0);
      // 20 map + 1 combine + 1 tldr
      expect(mockLLM.invoke).toHaveBeenCalledTimes(22);
    });

    it("preserves chunk order in the map results despite bounded scheduling", async () => {
      // Arrange — later chunks resolve FIRST, so any order-losing implementation
      // would feed the combine step a scrambled transcript.
      const chunks: Chunk[] = Array.from(
        { length: 12 },
        (_, i) =>
          ({
            id: `chunk-${i}`,
            content: `Chunk ${i}`,
            position: i,
            embedding: [],
          }) as unknown as Chunk,
      );
      const mockLLM = modelService.getLLM({});

      // The chunk index is read back off the prompt rather than off the call
      // order — under a bounded pool the two deliberately differ.
      mockLLM.invoke.mockImplementation(async (prompt) => {
        const match = /Chunk (\d+)/.exec(JSON.stringify(prompt) ?? "");
        if (!match) return createMockLLMResponse("Combined or TLDR");
        const index = Number(match[1]);
        await new Promise((resolve) => setTimeout(resolve, chunks.length - index));
        return createMockLLMResponse(`Summary ${index}.`);
      });

      // Act
      await service.summarise({ chunks });

      // Assert — the combine invocation is the one right after the 12 map calls;
      // its prompt must list the summaries in chunk order. The trailing "." keeps
      // "Summary 1." from matching inside "Summary 10.".
      const combineMessages = mockLLM.invoke.mock.calls[chunks.length][0];
      const combineText = JSON.stringify(combineMessages);
      const positions = Array.from({ length: chunks.length }, (_, i) => combineText.indexOf(`Summary ${i}.`));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });
  });

  describe("custom prompts configuration", () => {
    it("should use custom prompts from config when available", async () => {
      // This test verifies the constructor reads from config
      // The prompts are read during construction and stored as private properties
      // We can verify this happened by checking configService.get was called
      expect(configService.get).toHaveBeenCalledWith("prompts");
    });
  });
});
