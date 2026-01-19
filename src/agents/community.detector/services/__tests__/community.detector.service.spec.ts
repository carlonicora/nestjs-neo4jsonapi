import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { CommunityDetectorService } from "../community.detector.service";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { CommunityRepository } from "../../../../foundations/community/repositories/community.repository";
import { CommunitySummariserService } from "../../../community.summariser/services/community.summariser.service";

describe("CommunityDetectorService", () => {
  let service: CommunityDetectorService;
  let neo4jService: MockedObject<Neo4jService>;
  let logger: MockedObject<AppLoggingService>;
  let communityRepository: MockedObject<CommunityRepository>;
  let summariserService: MockedObject<CommunitySummariserService>;

  const TEST_IDS = {
    companyId: "550e8400-e29b-41d4-a716-446655440000",
    communityId: "660e8400-e29b-41d4-a716-446655440001",
    keyConceptId: "770e8400-e29b-41d4-a716-446655440002",
    contentId: "880e8400-e29b-41d4-a716-446655440003",
  };

  const createMockNeo4jService = () => ({
    initQuery: vi.fn().mockReturnValue({
      query: "",
      queryParams: {},
    }),
    read: vi.fn(),
    writeOne: vi.fn(),
    readOne: vi.fn(),
    readMany: vi.fn(),
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

  const createMockCommunityRepository = () => ({
    deleteAllCommunities: vi.fn(),
    createCommunity: vi.fn(),
    updateCommunityMembers: vi.fn(),
    setParentCommunity: vi.fn(),
    markAsStale: vi.fn(),
    findCommunitiesByKeyConcept: vi.fn(),
    findOrphanKeyConceptsForContent: vi.fn(),
    findCommunitiesByRelatedKeyConcepts: vi.fn(),
    addMemberToCommunity: vi.fn(),
    findById: vi.fn(),
  });

  const createMockSummariserService = () => ({
    generateSummary: vi.fn(),
    processStaleCommunities: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockNeo4jService = createMockNeo4jService();
    const mockLogger = createMockLogger();
    const mockCommunityRepository = createMockCommunityRepository();
    const mockSummariserService = createMockSummariserService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityDetectorService,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: AppLoggingService, useValue: mockLogger },
        { provide: CommunityRepository, useValue: mockCommunityRepository },
        { provide: CommunitySummariserService, useValue: mockSummariserService },
      ],
    }).compile();

    service = module.get<CommunityDetectorService>(CommunityDetectorService);
    neo4jService = module.get(Neo4jService) as MockedObject<Neo4jService>;
    logger = module.get(AppLoggingService) as MockedObject<AppLoggingService>;
    communityRepository = module.get(CommunityRepository) as MockedObject<CommunityRepository>;
    summariserService = module.get(CommunitySummariserService) as MockedObject<CommunitySummariserService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("detectCommunities", () => {
    it("should delete existing communities before detection", async () => {
      // Arrange - GDS not available
      neo4jService.read.mockResolvedValue({ records: [] });

      // Act
      await service.detectCommunities();

      // Assert
      expect(communityRepository.deleteAllCommunities).toHaveBeenCalled();
    });

    it("should skip detection when GDS is not available", async () => {
      // Arrange - GDS check throws
      neo4jService.read.mockRejectedValue(new Error("GDS not available"));

      // Act
      await service.detectCommunities();

      // Assert
      expect(logger.warn).toHaveBeenCalledWith(
        "Neo4j GDS not available, skipping community detection",
        "CommunityDetectorService",
      );
      expect(communityRepository.createCommunity).not.toHaveBeenCalled();
    });

    it("should skip detection when GDS check returns no records", async () => {
      // Arrange
      neo4jService.read.mockResolvedValue({ records: [] });

      // Act
      await service.detectCommunities();

      // Assert
      expect(logger.warn).toHaveBeenCalledWith(
        "Neo4j GDS not available, skipping community detection",
        "CommunityDetectorService",
      );
    });

    it("should log GDS version when available", async () => {
      // Arrange
      const mockVersionRecord = { get: vi.fn().mockReturnValue("2.6.0") };
      const mockCountRecord = { get: vi.fn().mockReturnValue({ toNumber: () => 0 }) };

      neo4jService.read
        .mockResolvedValueOnce({ records: [mockVersionRecord] }) // GDS version check
        .mockResolvedValueOnce({ records: [mockCountRecord] }); // KeyConcept count

      // Act
      await service.detectCommunities();

      // Assert
      expect(logger.log).toHaveBeenCalledWith("Neo4j GDS version 2.6.0 detected", "CommunityDetectorService");
    });

    it("should skip detection when no KeyConcepts exist", async () => {
      // Arrange
      const mockVersionRecord = { get: vi.fn().mockReturnValue("2.6.0") };
      const mockCountRecord = { get: vi.fn().mockReturnValue({ toNumber: () => 0 }) };

      neo4jService.read
        .mockResolvedValueOnce({ records: [mockVersionRecord] }) // GDS version check
        .mockResolvedValueOnce({ records: [mockCountRecord] }); // KeyConcept count

      // Act
      await service.detectCommunities();

      // Assert
      expect(logger.warn).toHaveBeenCalledWith(
        "No KeyConcepts found for company, skipping community detection",
        "CommunityDetectorService",
      );
      expect(communityRepository.createCommunity).not.toHaveBeenCalled();
    });

    it("should create community nodes for detected clusters", async () => {
      // Arrange
      const mockVersionRecord = { get: vi.fn().mockReturnValue("2.6.0") };
      const mockCountRecord = { get: vi.fn().mockReturnValue({ toNumber: () => 10 }) };
      const mockProjectRecord = {
        get: vi.fn().mockImplementation((key) => {
          if (key === "nodeCount") return { toNumber: () => 10 };
          if (key === "relationshipCount") return { toNumber: () => 5 };
          return null;
        }),
      };
      const mockLouvainRecords = [
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc1" : { toNumber: () => 1 })) },
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc2" : { toNumber: () => 1 })) },
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc3" : { toNumber: () => 1 })) },
      ];

      neo4jService.read
        .mockResolvedValueOnce({ records: [mockVersionRecord] }) // GDS version check
        .mockResolvedValueOnce({ records: [mockCountRecord] }) // KeyConcept count
        .mockResolvedValueOnce({ records: [mockProjectRecord] }) // Graph projection
        .mockResolvedValueOnce({ records: mockLouvainRecords }); // Louvain result

      neo4jService.writeOne.mockResolvedValue(null); // Drop graph

      communityRepository.createCommunity.mockResolvedValue({
        id: TEST_IDS.communityId,
        name: "Community L0",
        level: 0,
        memberCount: 3,
        rating: 0,
      });
      communityRepository.updateCommunityMembers.mockResolvedValue(undefined);

      // Act
      await service.detectCommunities();

      // Assert
      expect(communityRepository.createCommunity).toHaveBeenCalledWith({
        name: "Community L0",
        level: 0,
        memberCount: 3,
        rating: 0,
      });
      expect(communityRepository.updateCommunityMembers).toHaveBeenCalledWith({
        communityId: TEST_IDS.communityId,
        keyConceptIds: ["kc1", "kc2", "kc3"],
      });
    });

    it("should skip communities smaller than minimum size", async () => {
      // Arrange
      const mockVersionRecord = { get: vi.fn().mockReturnValue("2.6.0") };
      const mockCountRecord = { get: vi.fn().mockReturnValue({ toNumber: () => 10 }) };
      const mockProjectRecord = {
        get: vi.fn().mockImplementation((key) => {
          if (key === "nodeCount") return { toNumber: () => 10 };
          if (key === "relationshipCount") return { toNumber: () => 5 };
          return null;
        }),
      };
      // Only 2 members in community (below minCommunitySize of 3)
      const mockLouvainRecords = [
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc1" : { toNumber: () => 1 })) },
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc2" : { toNumber: () => 1 })) },
      ];

      neo4jService.read
        .mockResolvedValueOnce({ records: [mockVersionRecord] })
        .mockResolvedValueOnce({ records: [mockCountRecord] })
        .mockResolvedValueOnce({ records: [mockProjectRecord] })
        .mockResolvedValueOnce({ records: mockLouvainRecords });

      neo4jService.writeOne.mockResolvedValue(null);

      // Act
      await service.detectCommunities();

      // Assert - no community should be created
      expect(communityRepository.createCommunity).not.toHaveBeenCalled();
    });

    it("should log and rethrow errors on failure", async () => {
      // Arrange
      communityRepository.deleteAllCommunities.mockRejectedValue(new Error("Delete failed"));

      // Act & Assert
      await expect(service.detectCommunities()).rejects.toThrow("Delete failed");
      expect(logger.error).toHaveBeenCalledWith(
        "Community detection failed: Delete failed",
        "CommunityDetectorService",
      );
    });

    it("should handle plain numbers without toNumber method for count", async () => {
      // Arrange
      const mockVersionRecord = { get: vi.fn().mockReturnValue("2.6.0") };
      const mockCountRecord = { get: vi.fn().mockReturnValue(0) }; // plain number

      neo4jService.read
        .mockResolvedValueOnce({ records: [mockVersionRecord] })
        .mockResolvedValueOnce({ records: [mockCountRecord] });

      // Act
      await service.detectCommunities();

      // Assert
      expect(logger.warn).toHaveBeenCalledWith(
        "No KeyConcepts found for company, skipping community detection",
        "CommunityDetectorService",
      );
    });

    it("should drop the graph after detection", async () => {
      // Arrange
      const mockVersionRecord = { get: vi.fn().mockReturnValue("2.6.0") };
      const mockCountRecord = { get: vi.fn().mockReturnValue({ toNumber: () => 10 }) };
      const mockProjectRecord = {
        get: vi.fn().mockImplementation((key) => {
          if (key === "nodeCount") return { toNumber: () => 10 };
          if (key === "relationshipCount") return { toNumber: () => 5 };
          return null;
        }),
      };
      const mockLouvainRecords = [
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc1" : { toNumber: () => 1 })) },
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc2" : { toNumber: () => 1 })) },
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc3" : { toNumber: () => 1 })) },
      ];

      neo4jService.read
        .mockResolvedValueOnce({ records: [mockVersionRecord] })
        .mockResolvedValueOnce({ records: [mockCountRecord] })
        .mockResolvedValueOnce({ records: [mockProjectRecord] })
        .mockResolvedValueOnce({ records: mockLouvainRecords });

      neo4jService.writeOne.mockResolvedValue(null);

      communityRepository.createCommunity.mockResolvedValue({
        id: TEST_IDS.communityId,
        name: "Community L0",
        level: 0,
        memberCount: 3,
        rating: 0,
      });

      // Act
      await service.detectCommunities();

      // Assert
      expect(neo4jService.writeOne).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("gds.graph.drop"),
        }),
      );
    });

    it("should silently ignore drop graph errors", async () => {
      // Arrange
      const mockVersionRecord = { get: vi.fn().mockReturnValue("2.6.0") };
      const mockCountRecord = { get: vi.fn().mockReturnValue({ toNumber: () => 10 }) };
      const mockProjectRecord = {
        get: vi.fn().mockImplementation((key) => {
          if (key === "nodeCount") return { toNumber: () => 10 };
          if (key === "relationshipCount") return { toNumber: () => 5 };
          return null;
        }),
      };
      const mockLouvainRecords = [
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc1" : { toNumber: () => 1 })) },
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc2" : { toNumber: () => 1 })) },
        { get: vi.fn().mockImplementation((key) => (key === "keyConceptId" ? "kc3" : { toNumber: () => 1 })) },
      ];

      neo4jService.read
        .mockResolvedValueOnce({ records: [mockVersionRecord] })
        .mockResolvedValueOnce({ records: [mockCountRecord] })
        .mockResolvedValueOnce({ records: [mockProjectRecord] })
        .mockResolvedValueOnce({ records: mockLouvainRecords });

      // Drop graph throws error
      neo4jService.writeOne.mockRejectedValue(new Error("Graph not found"));

      communityRepository.createCommunity.mockResolvedValue({
        id: TEST_IDS.communityId,
        name: "Community L0",
        level: 0,
        memberCount: 3,
        rating: 0,
      });

      // Act - should not throw
      await expect(service.detectCommunities()).resolves.not.toThrow();
    });
  });

  describe("markAffectedCommunitiesStale", () => {
    it("should mark communities as stale when KeyConcept has communities", async () => {
      // Arrange
      const communities = [{ id: "comm1" }, { id: "comm2" }];
      communityRepository.findCommunitiesByKeyConcept.mockResolvedValue(communities);

      // Act
      await service.markAffectedCommunitiesStale(TEST_IDS.keyConceptId);

      // Assert
      expect(communityRepository.findCommunitiesByKeyConcept).toHaveBeenCalledWith(TEST_IDS.keyConceptId);
      expect(communityRepository.markAsStale).toHaveBeenCalledWith(["comm1", "comm2"]);
      expect(logger.debug).toHaveBeenCalledWith(
        `Marked 2 communities as stale for KeyConcept ${TEST_IDS.keyConceptId}`,
        "CommunityDetectorService",
      );
    });

    it("should not call markAsStale when KeyConcept has no communities", async () => {
      // Arrange
      communityRepository.findCommunitiesByKeyConcept.mockResolvedValue([]);

      // Act
      await service.markAffectedCommunitiesStale(TEST_IDS.keyConceptId);

      // Assert
      expect(communityRepository.markAsStale).not.toHaveBeenCalled();
    });
  });

  describe("assignKeyConceptsToCommunities", () => {
    it("should log and return early when no orphan KeyConcepts found", async () => {
      // Arrange
      communityRepository.findOrphanKeyConceptsForContent.mockResolvedValue([]);

      // Act
      await service.assignKeyConceptsToCommunities(TEST_IDS.contentId, "Content");

      // Assert
      expect(logger.debug).toHaveBeenCalledWith("No orphan KeyConcepts to assign", "CommunityDetectorService");
      expect(communityRepository.findCommunitiesByRelatedKeyConcepts).not.toHaveBeenCalled();
    });

    it("should assign orphan KeyConcepts to communities with highest affinity", async () => {
      // Arrange
      const orphanIds = ["kc1", "kc2"];
      const relatedCommunities1 = [
        { communityId: TEST_IDS.communityId, totalWeight: 5.0, memberCount: 10, relationshipCount: 3 },
      ];
      const relatedCommunities2 = [{ communityId: "comm2", totalWeight: 3.0, memberCount: 8, relationshipCount: 2 }];

      communityRepository.findOrphanKeyConceptsForContent.mockResolvedValue(orphanIds);
      communityRepository.findCommunitiesByRelatedKeyConcepts
        .mockResolvedValueOnce(relatedCommunities1)
        .mockResolvedValueOnce(relatedCommunities2);
      communityRepository.addMemberToCommunity.mockResolvedValue(undefined);
      communityRepository.findById.mockResolvedValue({
        id: TEST_IDS.communityId,
        name: "Test Community",
        level: 0,
        memberCount: 10,
        rating: 50,
      });

      // Act
      await service.assignKeyConceptsToCommunities(TEST_IDS.contentId, "Content");

      // Assert
      expect(communityRepository.addMemberToCommunity).toHaveBeenCalledWith(TEST_IDS.communityId, "kc1");
      expect(communityRepository.addMemberToCommunity).toHaveBeenCalledWith("comm2", "kc2");
      expect(summariserService.generateSummary).toHaveBeenCalledTimes(2);
    });

    it("should not assign KeyConcepts with no related communities", async () => {
      // Arrange
      const orphanIds = ["kc1"];
      communityRepository.findOrphanKeyConceptsForContent.mockResolvedValue(orphanIds);
      communityRepository.findCommunitiesByRelatedKeyConcepts.mockResolvedValue([]);

      // Act
      await service.assignKeyConceptsToCommunities(TEST_IDS.contentId, "Content");

      // Assert
      expect(communityRepository.addMemberToCommunity).not.toHaveBeenCalled();
      expect(summariserService.generateSummary).not.toHaveBeenCalled();
    });

    it("should generate summaries only for unique affected communities", async () => {
      // Arrange
      const orphanIds = ["kc1", "kc2"];
      // Both KeyConcepts assigned to same community
      const relatedCommunities = [
        { communityId: TEST_IDS.communityId, totalWeight: 5.0, memberCount: 10, relationshipCount: 3 },
      ];

      communityRepository.findOrphanKeyConceptsForContent.mockResolvedValue(orphanIds);
      communityRepository.findCommunitiesByRelatedKeyConcepts.mockResolvedValue(relatedCommunities);
      communityRepository.addMemberToCommunity.mockResolvedValue(undefined);
      communityRepository.findById.mockResolvedValue({
        id: TEST_IDS.communityId,
        name: "Test Community",
        level: 0,
        memberCount: 10,
        rating: 50,
      });

      // Act
      await service.assignKeyConceptsToCommunities(TEST_IDS.contentId, "Content");

      // Assert - summary generated only once for the unique community
      expect(summariserService.generateSummary).toHaveBeenCalledTimes(1);
    });

    it("should not generate summary when community not found", async () => {
      // Arrange
      const orphanIds = ["kc1"];
      const relatedCommunities = [
        { communityId: TEST_IDS.communityId, totalWeight: 5.0, memberCount: 10, relationshipCount: 3 },
      ];

      communityRepository.findOrphanKeyConceptsForContent.mockResolvedValue(orphanIds);
      communityRepository.findCommunitiesByRelatedKeyConcepts.mockResolvedValue(relatedCommunities);
      communityRepository.addMemberToCommunity.mockResolvedValue(undefined);
      communityRepository.findById.mockResolvedValue(null);

      // Act
      await service.assignKeyConceptsToCommunities(TEST_IDS.contentId, "Content");

      // Assert
      expect(summariserService.generateSummary).not.toHaveBeenCalled();
    });

    it("should log the number of affected communities", async () => {
      // Arrange
      const orphanIds = ["kc1"];
      const relatedCommunities = [
        { communityId: TEST_IDS.communityId, totalWeight: 5.0, memberCount: 10, relationshipCount: 3 },
      ];

      communityRepository.findOrphanKeyConceptsForContent.mockResolvedValue(orphanIds);
      communityRepository.findCommunitiesByRelatedKeyConcepts.mockResolvedValue(relatedCommunities);
      communityRepository.addMemberToCommunity.mockResolvedValue(undefined);
      communityRepository.findById.mockResolvedValue({
        id: TEST_IDS.communityId,
        name: "Test Community",
        level: 0,
        memberCount: 10,
        rating: 50,
      });

      // Act
      await service.assignKeyConceptsToCommunities(TEST_IDS.contentId, "Content");

      // Assert
      expect(logger.log).toHaveBeenCalledWith(
        "Assigned KeyConcepts to 1 communities, generating summaries",
        "CommunityDetectorService",
      );
    });
  });
});
