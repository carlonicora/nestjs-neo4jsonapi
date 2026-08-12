import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { CommunitySummariserService, prompt } from "../community.summariser.service";
import { LLMService } from "../../../../core/llm/services/llm.service";
import { EmbedderService } from "../../../../core";
import { CommunityRepository } from "../../../../foundations/community/repositories/community.repository";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { Community } from "../../../../foundations/community/entities/community.entity";
import { communityMeta } from "../../../../foundations/community/entities/community.meta";
import { TokenUsageType } from "../../../../foundations/tokenusage/enums/tokenusage.type";

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
    findById: vi.fn(),
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

  describe("generateSummaryById", () => {
    it("should skip when community not found", async () => {
      // Arrange
      communityRepository.findById.mockResolvedValue(null);

      // Act
      await service.generateSummaryById("nonexistent");

      // Assert
      expect(logger.warn).toHaveBeenCalledWith(
        "Community nonexistent not found, skipping",
        "CommunitySummariserService",
      );
      expect(communityRepository.findMemberKeyConcepts).not.toHaveBeenCalled();
    });

    it("should find community and generate summary", async () => {
      // Arrange
      const community = createMockCommunity();
      communityRepository.findById.mockResolvedValue(community);
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
      await service.generateSummaryById(TEST_IDS.communityId);

      // Assert
      expect(communityRepository.findById).toHaveBeenCalledWith(TEST_IDS.communityId);
      expect(communityRepository.updateSummary).toHaveBeenCalled();
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
        attribution: {
          relationshipId: TEST_IDS.communityId,
          relationshipType: communityMeta.labelName,
          tokenUsageType: TokenUsageType.CommunitySummariser,
        },
      });
    });

    it("bills both the summary call and its embedding to the community", async () => {
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
          tokenUsageType: TokenUsageType.CommunitySummariser,
          relationshipId: TEST_IDS.communityId,
          relationshipType: "Community",
        }),
      );
      expect(embedderService.vectoriseText).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: expect.objectContaining({
            tokenUsageType: TokenUsageType.CommunitySummariser,
            relationshipId: TEST_IDS.communityId,
            relationshipType: "Community",
          }),
        }),
      );
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
