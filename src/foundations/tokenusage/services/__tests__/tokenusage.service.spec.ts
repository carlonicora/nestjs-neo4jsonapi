import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { TokenUsageService } from "../tokenusage.service";
import { TokenUsageRepository } from "../../repositories/tokenusage.repository";
import { TokenUsageType } from "../../enums/tokenusage.type";
import { ConfigAiInterface } from "../../../../config/interfaces/config.ai.interface";
import { ConfigCreditsInterface } from "../../../../config/interfaces/config.credits.interface";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { ModelWeight } from "../../../../core/llm/enums/model.weight";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { TOKEN_USAGE_RECORDED_EVENT } from "../../events/tokenusage.events";

describe("TokenUsageService", () => {
  let service: TokenUsageService;
  let tokenUsageRepository: MockedObject<TokenUsageRepository>;
  let configService: MockedObject<ConfigService>;
  let eventEmitter: MockedObject<EventEmitter2>;

  const TEST_IDS = {
    relationshipId: "550e8400-e29b-41d4-a716-446655440000",
  };

  const createMockTokenUsageRepository = () => ({
    create: vi.fn(),
    onModuleInit: vi.fn(),
  });

  const createMockEventEmitter = () => ({
    emit: vi.fn(),
  });

  // TokenUsageService extends AbstractService: JsonApiService + ClsService are
  // constructor dependencies of the abstract base and must be resolvable.
  const createMockJsonApiService = () => ({
    buildSingle: vi.fn(),
    buildList: vi.fn(),
  });

  const createMockClsService = () => ({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
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

  /**
   * Credits tracking is OFF by default in these fixtures (`creditCost: 0`) so
   * every pre-credits cost test keeps its exact expectations and records
   * `credits: 0`. The credits suite opts in with CREDITS_ENABLED.
   */
  const DISABLED_CREDITS: ConfigCreditsInterface = { creditCost: 0, minCreditsPerRecord: 0.1 };

  /** a360ai production values: € per credit 0.004, floor 0.1 credits per record. */
  const CREDITS_ENABLED: ConfigCreditsInterface = { creditCost: 0.004, minCreditsPerRecord: 0.1 };

  const createMockConfigService = (
    aiConfig: ConfigAiInterface,
    creditsConfig: ConfigCreditsInterface | undefined = DISABLED_CREDITS,
  ) => ({
    get: vi.fn((key: string) => {
      if (key === "ai") {
        return aiConfig;
      }
      if (key === "credits") {
        return creditsConfig;
      }
      return undefined;
    }),
  });

  /**
   * Builds an isolated service with per-test cost rates and credits config.
   * Returns the repository and event-emitter mocks as well, so credits cases can
   * assert on BOTH the persisted record and the emitted payload.
   */
  const buildServiceWithRates = async (rates: {
    inputCostPer1MTokens?: number;
    outputCostPer1MTokens?: number;
    cachedInputCostPer1MTokens?: number;
    credits?: ConfigCreditsInterface;
  }) => {
    const config = createMockAiConfig();
    if (rates.inputCostPer1MTokens !== undefined) {
      config.ai.inputCostPer1MTokens = rates.inputCostPer1MTokens;
    }
    if (rates.outputCostPer1MTokens !== undefined) {
      config.ai.outputCostPer1MTokens = rates.outputCostPer1MTokens;
    }
    if (rates.cachedInputCostPer1MTokens !== undefined) {
      (config.ai as { cachedInputCostPer1MTokens?: number }).cachedInputCostPer1MTokens =
        rates.cachedInputCostPer1MTokens;
    }

    // `"credits" in rates` (not `??`) so a test can pass `credits: undefined`
    // explicitly to model a consumer with NO credits config block at all.
    const creditsConfig = "credits" in rates ? rates.credits : DISABLED_CREDITS;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenUsageService,
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: TokenUsageRepository, useValue: createMockTokenUsageRepository() },
        { provide: ClsService, useValue: createMockClsService() },
        { provide: ConfigService, useValue: createMockConfigService(config, creditsConfig) },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    return {
      service: module.get<TokenUsageService>(TokenUsageService),
      repository: module.get(TokenUsageRepository) as MockedObject<TokenUsageRepository>,
      eventEmitter: module.get(EventEmitter2) as MockedObject<EventEmitter2>,
    };
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockAiConfig = createMockAiConfig();
    const mockTokenUsageRepository = createMockTokenUsageRepository();
    const mockConfigService = createMockConfigService(mockAiConfig);
    const mockEventEmitter = createMockEventEmitter();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenUsageService,
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: TokenUsageRepository, useValue: mockTokenUsageRepository },
        { provide: ClsService, useValue: createMockClsService() },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<TokenUsageService>(TokenUsageService);
    tokenUsageRepository = module.get(TokenUsageRepository) as MockedObject<TokenUsageRepository>;
    configService = module.get(ConfigService) as MockedObject<ConfigService>;
    eventEmitter = module.get(EventEmitter2) as MockedObject<EventEmitter2>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("computeCost (cached input discount)", () => {
    it("bills cached tokens at the cached rate (cached is a subset of input)", async () => {
      // input=1000 (300 cached), output=500; inputRate=2, cachedRate=0.2, outputRate=8 per 1M
      // (1000-300)*2 + 300*0.2 + 500*8 = 1400 + 60 + 4000 = 5460  → /1e6
      const { service: svc } = await buildServiceWithRates({
        inputCostPer1MTokens: 2,
        outputCostPer1MTokens: 8,
        cachedInputCostPer1MTokens: 0.2,
      });
      const cost = svc.computeCost({ tokens: { input: 1000, output: 500, cached: 300 } });
      expect(cost).toBeCloseTo(5460 / 1_000_000, 12);
    });

    it("falls back to the input rate when no cached rate is configured (unchanged cost)", async () => {
      // cachedInputCostPer1MTokens undefined → cached billed at inputRate → same as no-cache
      const { service: svc } = await buildServiceWithRates({ inputCostPer1MTokens: 2, outputCostPer1MTokens: 8 });
      const withCache = svc.computeCost({ tokens: { input: 1000, output: 500, cached: 300 } });
      const noCache = svc.computeCost({ tokens: { input: 1000, output: 500 } });
      expect(withCache).toBeCloseTo(noCache, 12);
    });

    it("clamps cached to input (never negative uncached input)", async () => {
      const { service: svc } = await buildServiceWithRates({
        inputCostPer1MTokens: 2,
        outputCostPer1MTokens: 8,
        cachedInputCostPer1MTokens: 0.2,
      });
      const cost = svc.computeCost({ tokens: { input: 100, output: 0, cached: 500 } });
      const allCached = svc.computeCost({ tokens: { input: 100, output: 0, cached: 100 } });
      expect(cost).toBeCloseTo(allCached, 12);
    });
  });

  describe("recordTokenUsage", () => {
    it("emits the tokenusage.recorded event with the input/output tokens after recording", async () => {
      tokenUsageRepository.create.mockResolvedValue(undefined);

      await service.recordTokenUsage({
        tokens: { input: 1000, output: 500 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // Default fixture has credits disabled (creditCost 0) → credits 0.
      // Cost: (10 * 1000 + 30 * 500) / 1e6 = 0.025
      expect(eventEmitter.emit).toHaveBeenCalledWith(TOKEN_USAGE_RECORDED_EVENT, {
        input: 1000,
        output: 500,
        cost: 0.025,
        credits: 0,
      });
    });

    it("does not throw when the event emit fails (best-effort)", async () => {
      tokenUsageRepository.create.mockResolvedValue(undefined);
      eventEmitter.emit.mockImplementation(() => {
        throw new Error("emit boom");
      });

      await expect(
        service.recordTokenUsage({
          tokens: { input: 100, output: 50 },
          type: TokenUsageType.Summariser,
          relationshipId: TEST_IDS.relationshipId,
          relationshipType: "Content",
        }),
      ).resolves.toBeUndefined();

      expect(tokenUsageRepository.create).toHaveBeenCalled();
    });

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

      const mockConfigService = createMockConfigService(zeroInputCostConfig);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TokenUsageService,
          { provide: JsonApiService, useValue: createMockJsonApiService() },
          { provide: TokenUsageRepository, useValue: createMockTokenUsageRepository() },
          { provide: ClsService, useValue: createMockClsService() },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: EventEmitter2, useValue: createMockEventEmitter() },
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

      const mockConfigService = createMockConfigService(config);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TokenUsageService,
          { provide: JsonApiService, useValue: createMockJsonApiService() },
          { provide: TokenUsageRepository, useValue: createMockTokenUsageRepository() },
          { provide: ClsService, useValue: createMockClsService() },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: EventEmitter2, useValue: createMockEventEmitter() },
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

      const mockConfigService = createMockConfigService(zeroOutputCostConfig);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TokenUsageService,
          { provide: JsonApiService, useValue: createMockJsonApiService() },
          { provide: TokenUsageRepository, useValue: createMockTokenUsageRepository() },
          { provide: ClsService, useValue: createMockClsService() },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: EventEmitter2, useValue: createMockEventEmitter() },
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

  /**
   * Credits are the customer-facing billing unit:
   *   credits = max(minCreditsPerRecord, round4(cost / creditCost))
   * The "migration pin" cases below encode the exact figures agreed for the
   * page → credit migration and must not drift. Precision moved from 2 to 4
   * decimals (task-12) so sub-cent, high-volume operations (transcription
   * utterances, embeddings) stop rounding to 0.00 credits; the pins below were
   * recomputed at 4dp — see task-12-report.md for the before/after values.
   */
  describe("recordTokenUsage (credits)", () => {
    // a360ai production rates for the pinned cases: € 0.1 / 1M input,
    // € 0.4 / 1M output; creditCost € 0.004, minCreditsPerRecord 0.1.
    const A360_RATES = {
      inputCostPer1MTokens: 0.1,
      outputCostPer1MTokens: 0.4,
      credits: CREDITS_ENABLED,
    };

    it("charges credits proportionally to true cost (migration pin: 9.5084)", async () => {
      const { service: svc, repository } = await buildServiceWithRates(A360_RATES);

      await svc.recordTokenUsage({
        tokens: { input: 285_159, output: 23_794 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // (285159 * 0.1 + 23794 * 0.4) / 1e6 = 0.0380335 → / 0.004 = 9.508375 → round4 → 9.5084
      const createCall = repository.create.mock.calls[0][0];
      expect(createCall.cost).toBeCloseTo(0.0380335, 10);
      expect(createCall.credits).toBe(9.5084);
    });

    it("floors a tiny call at minCreditsPerRecord (migration pin: 0.1)", async () => {
      const { service: svc, repository } = await buildServiceWithRates(A360_RATES);

      await svc.recordTokenUsage({
        tokens: { input: 1_000, output: 200 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // cost 0.00018 → 0.045 credits → below the 0.1 floor
      const createCall = repository.create.mock.calls[0][0];
      expect(createCall.cost).toBeCloseTo(0.00018, 10);
      expect(createCall.credits).toBe(0.1);
    });

    it("rounds to 4 decimals (migration pin: 3.25)", async () => {
      const { service: svc, repository } = await buildServiceWithRates(A360_RATES);

      await svc.recordTokenUsage({
        tokens: { input: 90_000, output: 10_000 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // (90000 * 0.1 + 10000 * 0.4) / 1e6 = 0.013 → / 0.004 = 3.25
      const createCall = repository.create.mock.calls[0][0];
      expect(createCall.cost).toBeCloseTo(0.013, 10);
      expect(createCall.credits).toBe(3.25);
    });

    it("uses the aiLarge rates for credits when modelWeight is Large", async () => {
      const { service: svc, repository } = await buildServiceWithRates({ credits: CREDITS_ENABLED });

      await svc.recordTokenUsage({
        tokens: { input: 100_000, output: 10_000 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
        modelWeight: ModelWeight.Large,
      });

      // aiLarge: (100000 * 50 + 10000 * 100) / 1e6 = 6 € → / 0.004 = 1500 credits
      const createCall = repository.create.mock.calls[0][0];
      expect(createCall.cost).toBe(6);
      expect(createCall.credits).toBe(1500);
    });

    it("uses the vision rates for credits when useVisionCosts is true", async () => {
      const { service: svc, repository } = await buildServiceWithRates({ credits: CREDITS_ENABLED });

      await svc.recordTokenUsage({
        tokens: { input: 100_000, output: 10_000 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
        useVisionCosts: true,
      });

      // vision: (100000 * 20 + 10000 * 60) / 1e6 = 2.6 € → / 0.004 = 650 credits
      const createCall = repository.create.mock.calls[0][0];
      expect(createCall.cost).toBe(2.6);
      expect(createCall.credits).toBe(650);
    });

    it("discounts cached input in the credits figure", async () => {
      const { service: svc, repository } = await buildServiceWithRates({
        inputCostPer1MTokens: 10,
        outputCostPer1MTokens: 0,
        cachedInputCostPer1MTokens: 1,
        credits: CREDITS_ENABLED,
      });

      await svc.recordTokenUsage({
        tokens: { input: 1_000_000, output: 0, cached: 500_000 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });
      await svc.recordTokenUsage({
        tokens: { input: 1_000_000, output: 0 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      // cached:   (500000 * 10 + 500000 * 1) / 1e6 = 5.5 € → 1375 credits
      // uncached: (1000000 * 10) / 1e6          = 10  € → 2500 credits
      const cachedCall = repository.create.mock.calls[0][0];
      const uncachedCall = repository.create.mock.calls[1][0];
      expect(cachedCall.credits).toBe(1375);
      expect(uncachedCall.credits).toBe(2500);
      expect(cachedCall.credits).toBeLessThan(uncachedCall.credits!);
    });

    it("skips the floor when applyMinimum is false", async () => {
      const { service: svc, repository } = await buildServiceWithRates(A360_RATES);

      await svc.recordTokenUsage({
        tokens: { input: 1_000, output: 200 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
        applyMinimum: false,
      });

      // cost 0.00018 → 0.00018 / 0.004 = 0.045 → round4 → 0.045, no floor applied
      const createCall = repository.create.mock.calls[0][0];
      expect(createCall.credits).toBe(0.045);
    });

    it("uses costOverride verbatim instead of computeCost when provided", async () => {
      const { service: svc, repository } = await buildServiceWithRates(A360_RATES);

      await svc.recordTokenUsage({
        tokens: { input: 285_159, output: 23_794 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
        costOverride: 0.02,
      });

      // computeCost would have produced 0.0380335 — the override wins.
      const createCall = repository.create.mock.calls[0][0];
      expect(createCall.cost).toBe(0.02);
      expect(createCall.credits).toBe(5);
    });

    it("records credits 0 and still records cost when creditCost is 0/absent", async () => {
      const disabled = await buildServiceWithRates({ ...A360_RATES, credits: DISABLED_CREDITS });
      const absent = await buildServiceWithRates({ ...A360_RATES, credits: undefined });

      for (const built of [disabled, absent]) {
        await built.service.recordTokenUsage({
          tokens: { input: 90_000, output: 10_000 },
          type: TokenUsageType.Summariser,
          relationshipId: TEST_IDS.relationshipId,
          relationshipType: "Content",
        });

        const createCall = built.repository.create.mock.calls[0][0];
        expect(createCall.cost).toBeCloseTo(0.013, 10);
        expect(createCall.credits).toBe(0);
      }
    });

    it("emits tokenusage.recorded with { input, output, cost, credits }", async () => {
      const { service: svc, eventEmitter: emitter } = await buildServiceWithRates(A360_RATES);

      await svc.recordTokenUsage({
        tokens: { input: 90_000, output: 10_000 },
        type: TokenUsageType.Summariser,
        relationshipId: TEST_IDS.relationshipId,
        relationshipType: "Content",
      });

      expect(emitter.emit).toHaveBeenCalledWith(TOKEN_USAGE_RECORDED_EVENT, {
        input: 90_000,
        output: 10_000,
        cost: 0.013,
        credits: 3.25,
      });
    });
  });
});
