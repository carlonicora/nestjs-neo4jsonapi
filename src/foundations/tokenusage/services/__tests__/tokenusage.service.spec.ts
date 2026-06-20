import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { TokenUsageService } from "../tokenusage.service";
import { TokenUsageRepository } from "../../repositories/tokenusage.repository";
import { TokenUsageType } from "../../enums/tokenusage.type";
import { ConfigAiInterface } from "../../../../config/interfaces/config.ai.interface";
import { ModelWeight } from "../../../../core/llm/enums/model.weight";

describe("TokenUsageService", () => {
  let service: TokenUsageService;
  let tokenUsageRepository: MockedObject<TokenUsageRepository>;
  let configService: MockedObject<ConfigService>;

  const TEST_IDS = {
    relationshipId: "550e8400-e29b-41d4-a716-446655440000",
  };

  const createMockTokenUsageRepository = () => ({
    create: vi.fn(),
    onModuleInit: vi.fn(),
  });

  const createMockAiConfig = (): ConfigAiInterface => ({
    ai: {
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4",
      url: "https://api.openai.com",
      inputCostPer1MTokens: 10,
      outputCostPer1MTokens: 30,
    },
    aiLite: {
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      url: "https://api.openai.com",
      inputCostPer1MTokens: 1,
      outputCostPer1MTokens: 2,
    },
    aiLarge: {
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4-turbo",
      url: "https://api.openai.com",
      inputCostPer1MTokens: 50,
      outputCostPer1MTokens: 100,
    },
    vision: {
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4-vision",
      url: "https://api.openai.com",
      inputCostPer1MTokens: 20,
      outputCostPer1MTokens: 60,
    },
    transcriber: {
      provider: "openai",
      apiKey: "test-key",
      model: "whisper-1",
    },
    embedder: {
      provider: "openai",
      apiKey: "test-key",
      url: "https://api.openai.com",
      model: "text-embedding-ada-002",
      dimensions: 1536,
    },
  });

  const createMockConfigService = (aiConfig: ConfigAiInterface) => ({
    get: vi.fn((key: string) => {
      if (key === "ai") {
        return aiConfig;
      }
      return undefined;
    }),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockAiConfig = createMockAiConfig();
    const mockTokenUsageRepository = createMockTokenUsageRepository();
    const mockConfigService = createMockConfigService(mockAiConfig);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenUsageService,
        { provide: TokenUsageRepository, useValue: mockTokenUsageRepository },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<TokenUsageService>(TokenUsageService);
    tokenUsageRepository = module.get(TokenUsageRepository) as MockedObject<TokenUsageRepository>;
    configService = module.get(ConfigService) as MockedObject<ConfigService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("recordTokenUsage", () => {
    it("should record token usage with calculated cost using AI config", async () => {
      // Arrange
      tokenUsageRepository.create.mockResolvedValue(undefined);

      // Act
      await service.recordTokenUsage({
        tokens: { input: 1000, output: 500 },
        type: TokenUsageType.GraphCreator,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // Assert
      expect(tokenUsageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenUsageType: TokenUsageType.GraphCreator,
          inputTokens: 1000,
          outputTokens: 500,
          relationshipId: TEST_IDS.relationshipId,
          relationshipType: "Content",
        }),
      );

      // Verify cost calculation: (10 * 1000 / 1000000) + (30 * 500 / 1000000) = 0.01 + 0.015 = 0.025
      const createCall = tokenUsageRepository.create.mock.calls[0][0];
      expect(createCall.cost).toBeCloseTo(0.025, 6);
    });

    it("should record token usage with calculated cost using vision config when useVisionCosts is true", async () => {
      // Arrange
      tokenUsageRepository.create.mockResolvedValue(undefined);

      // Act
      await service.recordTokenUsage({
        tokens: { input: 1000, output: 500 },
        type: TokenUsageType.Responder,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
        useVisionCosts: true,
      });

      // Assert
      expect(tokenUsageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenUsageType: TokenUsageType.Responder,
          inputTokens: 1000,
          outputTokens: 500,
          relationshipId: TEST_IDS.relationshipId,
          relationshipType: "Content",
        }),
      );

      // Verify cost calculation with vision config: (20 * 1000 / 1000000) + (60 * 500 / 1000000) = 0.02 + 0.03 = 0.05
      const createCall = tokenUsageRepository.create.mock.calls[0][0];
      expect(createCall.cost).toBeCloseTo(0.05, 6);
    });

    it("computes cost from the output rate alone when inputCostPer1MTokens is 0", async () => {
      // Arrange — input rate free, output rate non-zero
      const zeroInputCostConfig = createMockAiConfig();
      zeroInputCostConfig.ai.inputCostPer1MTokens = 0;

      const mockConfigService = {
        get: vi.fn((key: string) => {
          if (key === "ai") {
            return zeroInputCostConfig;
          }
          return undefined;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TokenUsageService,
          { provide: TokenUsageRepository, useValue: createMockTokenUsageRepository() },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const serviceWithZeroCost = module.get<TokenUsageService>(TokenUsageService);
      const repoWithZeroCost = module.get(TokenUsageRepository) as MockedObject<TokenUsageRepository>;
      repoWithZeroCost.create.mockResolvedValue(undefined);

      // Act
      await serviceWithZeroCost.recordTokenUsage({
        tokens: { input: 1000, output: 500 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // Assert — only output contributes: (0 * 1000 / 1e6) + (30 * 500 / 1e6) = 0.015
      const createCall = repoWithZeroCost.create.mock.calls[0][0];
      expect(createCall.cost).toBeCloseTo(0.015, 6);
    });

    it("computes cost when only output rate is non-zero (input free)", async () => {
      // Arrange — input rate 0, output rate 5
      const config = createMockAiConfig();
      config.ai.inputCostPer1MTokens = 0;
      config.ai.outputCostPer1MTokens = 5;

      const mockConfigService = {
        get: vi.fn((key: string) => (key === "ai" ? config : undefined)),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TokenUsageService,
          { provide: TokenUsageRepository, useValue: createMockTokenUsageRepository() },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const svc = module.get<TokenUsageService>(TokenUsageService);
      const repo = module.get(TokenUsageRepository) as MockedObject<TokenUsageRepository>;
      repo.create.mockResolvedValue(undefined);

      // Act
      await svc.recordTokenUsage({
        tokens: { input: 1_000_000, output: 500_000 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // Assert — (0 * 1e6 / 1e6) + (5 * 500000 / 1e6) = 2.5
      const createCall = repo.create.mock.calls[0][0];
      expect(createCall.cost).toBeCloseTo(2.5, 6);
    });

    it("computes cost from the input rate alone when outputCostPer1MTokens is 0", async () => {
      // Arrange — output rate free, input rate non-zero
      const zeroOutputCostConfig = createMockAiConfig();
      zeroOutputCostConfig.ai.outputCostPer1MTokens = 0;

      const mockConfigService = {
        get: vi.fn((key: string) => {
          if (key === "ai") {
            return zeroOutputCostConfig;
          }
          return undefined;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TokenUsageService,
          { provide: TokenUsageRepository, useValue: createMockTokenUsageRepository() },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const serviceWithZeroCost = module.get<TokenUsageService>(TokenUsageService);
      const repoWithZeroCost = module.get(TokenUsageRepository) as MockedObject<TokenUsageRepository>;
      repoWithZeroCost.create.mockResolvedValue(undefined);

      // Act
      await serviceWithZeroCost.recordTokenUsage({
        tokens: { input: 1000, output: 500 },
        type: TokenUsageType.Ethicist,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // Assert — only input contributes: (10 * 1000 / 1e6) + (0 * 500 / 1e6) = 0.01
      const createCall = repoWithZeroCost.create.mock.calls[0][0];
      expect(createCall.cost).toBeCloseTo(0.01, 6);
    });

    it("should generate a unique UUID for each record", async () => {
      // Arrange
      tokenUsageRepository.create.mockResolvedValue(undefined);

      // Act
      await service.recordTokenUsage({
        tokens: { input: 100, output: 50 },
        type: TokenUsageType.Analyser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      await service.recordTokenUsage({
        tokens: { input: 200, output: 100 },
        type: TokenUsageType.Strategy,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // Assert
      const firstCall = tokenUsageRepository.create.mock.calls[0][0];
      const secondCall = tokenUsageRepository.create.mock.calls[1][0];
      expect(firstCall.id).toBeDefined();
      expect(secondCall.id).toBeDefined();
      expect(firstCall.id).not.toBe(secondCall.id);
    });

    it("should handle large token values correctly", async () => {
      // Arrange
      tokenUsageRepository.create.mockResolvedValue(undefined);

      // Act
      await service.recordTokenUsage({
        tokens: { input: 1000000, output: 500000 },
        type: TokenUsageType.GraphCreator,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // Assert
      // Cost: (10 * 1000000 / 1000000) + (30 * 500000 / 1000000) = 10 + 15 = 25
      const createCall = tokenUsageRepository.create.mock.calls[0][0];
      expect(createCall.cost).toBeCloseTo(25, 5);
      expect(createCall.inputTokens).toBe(1000000);
      expect(createCall.outputTokens).toBe(500000);
    });

    it("should handle zero token values", async () => {
      // Arrange
      tokenUsageRepository.create.mockResolvedValue(undefined);

      // Act
      await service.recordTokenUsage({
        tokens: { input: 0, output: 0 },
        type: TokenUsageType.Responder,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // Assert
      const createCall = tokenUsageRepository.create.mock.calls[0][0];
      expect(createCall.cost).toBe(0);
      expect(createCall.inputTokens).toBe(0);
      expect(createCall.outputTokens).toBe(0);
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      tokenUsageRepository.create.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(
        service.recordTokenUsage({
          tokens: { input: 100, output: 50 },
          type: TokenUsageType.CounterpartIdentificator,
          relationshipId: TEST_IDS.relationshipId,
          relationshipType: "Content",
        }),
      ).rejects.toThrow("Database error");
    });

    it("should pass correct relationship type to repository", async () => {
      // Arrange
      tokenUsageRepository.create.mockResolvedValue(undefined);

      // Act
      await service.recordTokenUsage({
        tokens: { input: 100, output: 50 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Chunk",
      });

      // Assert
      expect(tokenUsageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          relationshipType: "Chunk",
        }),
      );
    });

    it("should handle all TokenUsageType values", async () => {
      // Arrange
      tokenUsageRepository.create.mockResolvedValue(undefined);

      const types = [
        TokenUsageType.GraphCreator,
        TokenUsageType.CounterpartIdentificator,
        TokenUsageType.Summariser,
        TokenUsageType.Responder,
        TokenUsageType.Ethicist,
        TokenUsageType.Analyser,
        TokenUsageType.Strategy,
      ];

      // Act & Assert
      for (const type of types) {
        await service.recordTokenUsage({
          tokens: { input: 100, output: 50 },
          type,
          relationshipId: TEST_IDS.relationshipId,
          relationshipType: "Content",
        });

        expect(tokenUsageRepository.create).toHaveBeenLastCalledWith(
          expect.objectContaining({
            tokenUsageType: type,
          }),
        );
      }
    });

    it("should default useVisionCosts to false and use AI config", async () => {
      // Arrange
      tokenUsageRepository.create.mockResolvedValue(undefined);

      // Act
      await service.recordTokenUsage({
        tokens: { input: 1000, output: 500 },
        type: TokenUsageType.GraphCreator,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
        // useVisionCosts not specified - should default to false
      });

      // Assert - should use AI config (inputCostPer1MTokens: 10, outputCostPer1MTokens: 30)
      const createCall = tokenUsageRepository.create.mock.calls[0][0];
      // Cost: (10 * 1000 / 1000000) + (30 * 500 / 1000000) = 0.01 + 0.015 = 0.025
      expect(createCall.cost).toBeCloseTo(0.025, 6);
    });

    it("uses the lite cost block when modelWeight is Lite", async () => {
      await service.recordTokenUsage({
        tokens: { input: 1_000_000, output: 1_000_000 },
        type: TokenUsageType.Summariser,
        relationshipId: "r1",
        relationshipType: "Rel",
        modelWeight: ModelWeight.Lite,
      });
      expect(tokenUsageRepository.create).toHaveBeenCalledWith(expect.objectContaining({ cost: 1 + 2 }));
    });

    it("uses the large cost block when modelWeight is Large", async () => {
      await service.recordTokenUsage({
        tokens: { input: 1_000_000, output: 1_000_000 },
        type: TokenUsageType.Summariser,
        relationshipId: "r1",
        relationshipType: "Rel",
        modelWeight: ModelWeight.Large,
      });
      expect(tokenUsageRepository.create).toHaveBeenCalledWith(expect.objectContaining({ cost: 50 + 100 }));
    });

    it("ignores modelWeight and uses vision costs when useVisionCosts is true", async () => {
      await service.recordTokenUsage({
        tokens: { input: 1_000_000, output: 1_000_000 },
        type: TokenUsageType.Summariser,
        relationshipId: "r1",
        relationshipType: "Rel",
        useVisionCosts: true,
        modelWeight: ModelWeight.Large,
      });
      expect(tokenUsageRepository.create).toHaveBeenCalledWith(expect.objectContaining({ cost: 20 + 60 }));
    });
  });
});
