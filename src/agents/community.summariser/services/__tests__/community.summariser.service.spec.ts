import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { CommunitySummariserService, prompt } from "../community.summariser.service";
import { LLMService } from "../../../../core/llm/services/llm.service";
import { EmbedderService } from "../../../../core";
import { CommunityRepository } from "../../../../foundations/community/repositories/community.repository";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { Community } from "../../../../foundations/community/entities/community.entity";

describe("CommunitySummariserService", () => {
  let service: CommunitySummariserService;
  let llmService: MockedObject<LLMService>;
  let embedderService: MockedObject<EmbedderService>;
  let communityRepository: MockedObject<CommunityRepository>;
  let logger: MockedObject<AppLoggingService>;
  let configService: MockedObject<ConfigService>;

  const TEST_IDS = {
    communityId: "550e8400-e29b-41d4-a716-446655440000",
  };

  const createMockLLMService = () => ({
    call: vi.fn(),
  });

  const createMockEmbedderService = () => ({
    vectoriseText: vi.fn(),
  });

  const createMockCommunityRepository = () => ({
    findStaleCommunities: vi.fn(),
    findMemberKeyConcepts: vi.fn(),
    findMemberRelationships: vi.fn(),
    updateSummary: vi.fn(),
  });

  const createMockLogger = () => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    logWithContext: vi.fn(),
    errorWithContext: vi.fn(),
    setRequestContext: vi.fn(),
    getRequestContext: vi.fn(),
    clearRequestContext: vi.fn(),
    createChildLogger: vi.fn(),
    logHttpRequest: vi.fn(),
    logHttpError: vi.fn(),
    logBusinessEvent: vi.fn(),
    logSecurityEvent: vi.fn(),
  });

  const createMockConfigService = () => ({
    get: vi.fn().mockReturnValue(undefined),
  });

  const createMockCommunity = (overrides: Partial<Community> = {}): Community =>
    ({
      id: TEST_IDS.communityId,
      name: "Test Community",
      level: 0,
      memberCount: 5,
      rating: 50,
      isStale: true,
      ...overrides,
    }) as Community;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockLLMService = createMockLLMService();
    const mockEmbedderService = createMockEmbedderService();
    const mockCommunityRepository = createMockCommunityRepository();
    const mockLogger = createMockLogger();
    const mockConfigService = createMockConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunitySummariserService,
        { provide: LLMService, useValue: mockLLMService },
        { provide: EmbedderService, useValue: mockEmbedderService },
        { provide: CommunityRepository, useValue: mockCommunityRepository },
        { provide: AppLoggingService, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CommunitySummariserService>(CommunitySummariserService);
    llmService = module.get(LLMService) as MockedObject<LLMService>;
    embedderService = module.get(EmbedderService) as MockedObject<EmbedderService>;
    communityRepository = module.get(CommunityRepository) as MockedObject<CommunityRepository>;
    logger = module.get(AppLoggingService) as MockedObject<AppLoggingService>;
    configService = module.get(ConfigService) as MockedObject<ConfigService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });

    it("should use default prompt when config does not provide one", () => {
      // The default prompt is used (configService.get returns undefined)
      expect(configService.get).toHaveBeenCalledWith("prompts");
    });

    it("should use custom prompt when config provides one", async () => {
      // Arrange
      const customPrompt = "Custom prompt";
      const mockConfigService = {
        get: vi.fn().mockReturnValue({ communitySummariser: customPrompt }),
      };

      // Act
      const module = await Test.createTestingModule({
        providers: [
          CommunitySummariserService,
          { provide: LLMService, useValue: createMockLLMService() },
          { provide: EmbedderService, useValue: createMockEmbedderService() },
          { provide: CommunityRepository, useValue: createMockCommunityRepository() },
          { provide: AppLoggingService, useValue: createMockLogger() },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const serviceWithCustomPrompt = module.get<CommunitySummariserService>(CommunitySummariserService);

      // Assert
      expect(serviceWithCustomPrompt).toBeDefined();
      expect(mockConfigService.get).toHaveBeenCalledWith("prompts");
    });
  });

  describe("processStaleCommunities", () => {
    it("should return 0 when no stale communities found", async () => {
      // Arrange
      communityRepository.findStaleCommunities.mockResolvedValue([]);

      // Act
      const result = await service.processStaleCommunities(10);

      // Assert
      expect(result).toBe(0);
      expect(communityRepository.findStaleCommunities).toHaveBeenCalledWith(10);
      expect(logger.debug).toHaveBeenCalledWith("Found 0 stale communities to process", "CommunitySummariserService");
    });

    it("should use default batch size of 10", async () => {
      // Arrange
      communityRepository.findStaleCommunities.mockResolvedValue([]);

      // Act
      await service.processStaleCommunities();

      // Assert
      expect(communityRepository.findStaleCommunities).toHaveBeenCalledWith(10);
    });

    it("should process all stale communities and return count", async () => {
      // Arrange
      const staleCommunities = [createMockCommunity({ id: "comm1" }), createMockCommunity({ id: "comm2" })];

      communityRepository.findStaleCommunities.mockResolvedValue(staleCommunities);
      communityRepository.findMemberKeyConcepts.mockResolvedValue([
        { id: "kc1", value: "Concept 1", description: "Description 1" },
      ]);
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: "Test Title",
        summary: "Test Summary",
        rating: 75,
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      const result = await service.processStaleCommunities(10);

      // Assert
      expect(result).toBe(2);
    });

    it("should count communities even when they have no members (early return)", async () => {
      // Arrange
      const staleCommunities = [createMockCommunity({ id: "comm1" }), createMockCommunity({ id: "comm2" })];

      communityRepository.findStaleCommunities.mockResolvedValue(staleCommunities);
      communityRepository.findMemberKeyConcepts
        .mockResolvedValueOnce([]) // First community has no members (returns early, but doesn't throw)
        .mockResolvedValueOnce([{ id: "kc1", value: "Concept 1" }]); // Second community
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: "Test Title",
        summary: "Test Summary",
        rating: 75,
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      const result = await service.processStaleCommunities(10);

      // Assert - both communities counted since generateSummary doesn't throw
      expect(result).toBe(2);
      // Verify that LLM was only called once (for the community with members)
      expect(llmService.call).toHaveBeenCalledTimes(1);
    });

    it("should log errors and continue when processing fails", async () => {
      // Arrange
      const staleCommunities = [createMockCommunity({ id: "comm1" }), createMockCommunity({ id: "comm2" })];

      communityRepository.findStaleCommunities.mockResolvedValue(staleCommunities);
      communityRepository.findMemberKeyConcepts
        .mockRejectedValueOnce(new Error("Database error"))
        .mockResolvedValueOnce([{ id: "kc1", value: "Concept 1" }]);
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: "Test Title",
        summary: "Test Summary",
        rating: 75,
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      const result = await service.processStaleCommunities(10);

      // Assert
      expect(result).toBe(1); // Only second one processed
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to generate summary for community comm1: Database error",
        "CommunitySummariserService",
      );
    });
  });

  describe("generateSummary", () => {
    it("should skip communities with no members", async () => {
      // Arrange
      const community = createMockCommunity();
      communityRepository.findMemberKeyConcepts.mockResolvedValue([]);

      // Act
      await service.generateSummary(community);

      // Assert
      expect(logger.warn).toHaveBeenCalledWith(
        `Community ${TEST_IDS.communityId} has no members, skipping`,
        "CommunitySummariserService",
      );
      expect(llmService.call).not.toHaveBeenCalled();
    });

    it("should generate summary with entities and relationships", async () => {
      // Arrange
      const community = createMockCommunity();
      const members = [
        { id: "kc1", value: "Concept 1", description: "Description 1" },
        { id: "kc2", value: "Concept 2", description: "Description 2" },
      ];
      const relationships = [{ keyConcept1: "Concept 1", keyConcept2: "Concept 2", weight: 1.5 }];

      communityRepository.findMemberKeyConcepts.mockResolvedValue(members);
      communityRepository.findMemberRelationships.mockResolvedValue(relationships);
      llmService.call.mockResolvedValue({
        title: "Test Community Title",
        summary: "This is a test summary for the community.",
        rating: 85,
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      await service.generateSummary(community);

      // Assert
      expect(llmService.call).toHaveBeenCalledWith(
        expect.objectContaining({
          inputParams: expect.objectContaining({
            entities: "- Concept 1: Description 1\n- Concept 2: Description 2",
            relationships: "- Concept 1 <-> Concept 2 (weight: 1.5)",
            level: 0,
            memberCount: 2,
          }),
          systemPrompts: [prompt],
          temperature: 0.3,
        }),
      );
    });

    it("should format entities without descriptions correctly", async () => {
      // Arrange
      const community = createMockCommunity();
      const members = [
        { id: "kc1", value: "Concept 1" },
        { id: "kc2", value: "Concept 2", description: undefined },
      ];

      communityRepository.findMemberKeyConcepts.mockResolvedValue(members);
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: "Test Title",
        summary: "Test Summary",
        rating: 75,
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      await service.generateSummary(community);

      // Assert
      expect(llmService.call).toHaveBeenCalledWith(
        expect.objectContaining({
          inputParams: expect.objectContaining({
            entities: "- Concept 1\n- Concept 2",
          }),
        }),
      );
    });

    it("should handle communities with no relationships", async () => {
      // Arrange
      const community = createMockCommunity();
      const members = [{ id: "kc1", value: "Concept 1" }];

      communityRepository.findMemberKeyConcepts.mockResolvedValue(members);
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: "Test Title",
        summary: "Test Summary",
        rating: 75,
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      await service.generateSummary(community);

      // Assert
      expect(llmService.call).toHaveBeenCalledWith(
        expect.objectContaining({
          inputParams: expect.objectContaining({
            relationships: "No explicit relationships between members.",
          }),
        }),
      );
    });

    it("should generate embedding from title and summary", async () => {
      // Arrange
      const community = createMockCommunity();
      const members = [{ id: "kc1", value: "Concept 1" }];

      communityRepository.findMemberKeyConcepts.mockResolvedValue(members);
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: "Test Title",
        summary: "Test Summary Content",
        rating: 75,
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      await service.generateSummary(community);

      // Assert
      expect(embedderService.vectoriseText).toHaveBeenCalledWith({
        text: "Test Title\n\nTest Summary Content",
      });
    });

    it("should truncate title to 50 characters", async () => {
      // Arrange
      const community = createMockCommunity();
      const members = [{ id: "kc1", value: "Concept 1" }];
      const longTitle = "A".repeat(60); // 60 characters

      communityRepository.findMemberKeyConcepts.mockResolvedValue(members);
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: longTitle,
        summary: "Test Summary",
        rating: 75,
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      await service.generateSummary(community);

      // Assert
      expect(communityRepository.updateSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "A".repeat(50), // Truncated to 50
        }),
      );
    });

    it("should round rating to integer", async () => {
      // Arrange
      const community = createMockCommunity();
      const members = [{ id: "kc1", value: "Concept 1" }];

      communityRepository.findMemberKeyConcepts.mockResolvedValue(members);
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: "Test Title",
        summary: "Test Summary",
        rating: 75.7, // Non-integer
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      await service.generateSummary(community);

      // Assert
      expect(communityRepository.updateSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          rating: 76, // Rounded
        }),
      );
    });

    it("should update community with all summary data", async () => {
      // Arrange
      const community = createMockCommunity();
      const members = [{ id: "kc1", value: "Concept 1" }];
      const embedding = [0.1, 0.2, 0.3, 0.4];

      communityRepository.findMemberKeyConcepts.mockResolvedValue(members);
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: "Generated Title",
        summary: "Generated Summary",
        rating: 80,
      });
      embedderService.vectoriseText.mockResolvedValue(embedding);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      await service.generateSummary(community);

      // Assert
      expect(communityRepository.updateSummary).toHaveBeenCalledWith({
        communityId: TEST_IDS.communityId,
        name: "Generated Title",
        summary: "Generated Summary",
        embedding,
        rating: 80,
      });
    });

    it("should log debug message on successful generation", async () => {
      // Arrange
      const community = createMockCommunity();
      const members = [{ id: "kc1", value: "Concept 1" }];

      communityRepository.findMemberKeyConcepts.mockResolvedValue(members);
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: "Test Title",
        summary: "Test Summary",
        rating: 85,
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      await service.generateSummary(community);

      // Assert
      expect(logger.debug).toHaveBeenCalledWith(
        `Generated summary for community ${TEST_IDS.communityId}: "Test Title" (rating: 85)`,
        "CommunitySummariserService",
      );
    });

    it("should log debug message at start of generation", async () => {
      // Arrange
      const community = createMockCommunity({ level: 2 });
      const members = [{ id: "kc1", value: "Concept 1" }];

      communityRepository.findMemberKeyConcepts.mockResolvedValue(members);
      communityRepository.findMemberRelationships.mockResolvedValue([]);
      llmService.call.mockResolvedValue({
        title: "Test Title",
        summary: "Test Summary",
        rating: 85,
      });
      embedderService.vectoriseText.mockResolvedValue([0.1, 0.2, 0.3]);
      communityRepository.updateSummary.mockResolvedValue(undefined);

      // Act
      await service.generateSummary(community);

      // Assert
      expect(logger.debug).toHaveBeenCalledWith(
        `Generating summary for community ${TEST_IDS.communityId} (level: 2)`,
        "CommunitySummariserService",
      );
    });
  });

  describe("prompt export", () => {
    it("should export the default prompt", () => {
      expect(prompt).toBeDefined();
      expect(prompt).toContain("You are an expert knowledge analyst");
    });
  });
});
