import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { CommunityDetectorService } from "../community.detector.service";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { CommunityRepository } from "../../../../foundations/community/repositories/community.repository";
import { ClsService } from "nestjs-cls";
import { CommunityScopeFilterInterface } from "../../../../common/tokens";
import { ScopePredicateSource } from "../../../../common/repositories/scope-predicate.source";
import { GraphCatalogService } from "../../../graph/services/graph.catalog.service";

// NOTE: CommunitySummariserService import REMOVED - no longer a dependency

describe("CommunityDetectorService", () => {
  let service: CommunityDetectorService;
  let neo4jService: MockedObject<Neo4jService>;
  let logger: MockedObject<AppLoggingService>;
  let communityRepository: MockedObject<CommunityRepository>;

  const TEST_IDS = {
    companyId: "550e8400-e29b-41d4-a716-446655440000",
    communityId: "660e8400-e29b-41d4-a716-446655440001",
    keyConceptId: "770e8400-e29b-41d4-a716-446655440002",
    contentId: "880e8400-e29b-41d4-a716-446655440003",
  };

  const createMockNeo4jService = () => ({
    initQuery: vi.fn().mockReturnValue({ query: "", queryParams: {} }),
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
    countByLevel: vi.fn(),
    deleteCommunitiesForScope: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const mockNeo4jService = createMockNeo4jService();
    const mockLogger = createMockLogger();
    const mockCommunityRepository = createMockCommunityRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityDetectorService,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: AppLoggingService, useValue: mockLogger },
        { provide: CommunityRepository, useValue: mockCommunityRepository },
        { provide: ClsService, useValue: { get: vi.fn().mockReturnValue(TEST_IDS.companyId) } },
      ],
    }).compile();

    service = module.get<CommunityDetectorService>(CommunityDetectorService);
    neo4jService = module.get(Neo4jService) as MockedObject<Neo4jService>;
    logger = module.get(AppLoggingService) as MockedObject<AppLoggingService>;
    communityRepository = module.get(CommunityRepository) as MockedObject<CommunityRepository>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("assignKeyConceptsToCommunities", () => {
    it("should assign orphan KeyConcepts to communities with highest affinity", async () => {
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
      communityRepository.markAsStale.mockResolvedValue(undefined);

      await service.assignKeyConceptsToCommunities(TEST_IDS.contentId, "Content");

      expect(communityRepository.addMemberToCommunity).toHaveBeenCalledWith(TEST_IDS.communityId, "kc1");
      expect(communityRepository.addMemberToCommunity).toHaveBeenCalledWith("comm2", "kc2");
      expect(communityRepository.markAsStale).toHaveBeenCalledWith([TEST_IDS.communityId, "comm2"]);
    });

    it("should not assign KeyConcepts with no related communities", async () => {
      const orphanIds = ["kc1"];
      communityRepository.findOrphanKeyConceptsForContent.mockResolvedValue(orphanIds);
      communityRepository.findCommunitiesByRelatedKeyConcepts.mockResolvedValue([]);

      await service.assignKeyConceptsToCommunities(TEST_IDS.contentId, "Content");

      expect(communityRepository.addMemberToCommunity).not.toHaveBeenCalled();
      expect(communityRepository.markAsStale).not.toHaveBeenCalled();
    });

    it("should call markAsStale once with unique affected community IDs", async () => {
      const orphanIds = ["kc1", "kc2"];
      const relatedCommunities = [
        { communityId: TEST_IDS.communityId, totalWeight: 5.0, memberCount: 10, relationshipCount: 3 },
      ];

      communityRepository.findOrphanKeyConceptsForContent.mockResolvedValue(orphanIds);
      communityRepository.findCommunitiesByRelatedKeyConcepts.mockResolvedValue(relatedCommunities);
      communityRepository.addMemberToCommunity.mockResolvedValue(undefined);
      communityRepository.markAsStale.mockResolvedValue(undefined);

      await service.assignKeyConceptsToCommunities(TEST_IDS.contentId, "Content");

      expect(communityRepository.markAsStale).toHaveBeenCalledTimes(1);
      expect(communityRepository.markAsStale).toHaveBeenCalledWith([TEST_IDS.communityId]);
    });
  });

  describe("detectAndAssignCommunities", () => {
    it("should call detectCommunities() when countByLevel returns empty array (no communities)", async () => {
      communityRepository.countByLevel.mockResolvedValue([]);
      neo4jService.read.mockResolvedValue({ records: [] });

      await service.detectAndAssignCommunities(TEST_IDS.contentId, "Article");

      expect(communityRepository.deleteAllCommunities).toHaveBeenCalled();
      expect(communityRepository.findOrphanKeyConceptsForContent).not.toHaveBeenCalled();
    });

    it("should call assignKeyConceptsToCommunities() when communities exist", async () => {
      communityRepository.countByLevel.mockResolvedValue([{ level: 0, count: 5 }]);
      communityRepository.findOrphanKeyConceptsForContent.mockResolvedValue([]);

      await service.detectAndAssignCommunities(TEST_IDS.contentId, "Article");

      expect(communityRepository.findOrphanKeyConceptsForContent).toHaveBeenCalledWith(TEST_IDS.contentId, "Article");
      expect(communityRepository.deleteAllCommunities).not.toHaveBeenCalled();
    });
  });
  describe("scope filter (COMMUNITY_SCOPE_FILTER seam)", () => {
    const ROOT_A = { id: "root-a", type: "scope-roots", label: "ScopeRoot" };
    const ROOT_B = { id: "root-b", type: "scope-roots", label: "ScopeRoot" };

    let filter: { canGroup: ReturnType<typeof vi.fn> };
    let filtered: CommunityDetectorService;
    let detectAtLevel: ReturnType<typeof vi.spyOn>;

    const catalog = {
      getAllEntities: vi.fn(() => [
        {
          type: "scope-roots",
          labelName: "ScopeRoot",
          scope: { path: [], rootType: "scope-roots", rootLabel: "ScopeRoot" },
        },
      ]),
    } as unknown as GraphCatalogService;
    const scopePredicates = {
      build: vi.fn(() => ({ cypher: "data.id = $agentScopeId", params: { agentScopeId: "x" } })),
    } as unknown as ScopePredicateSource;
    const cls = { get: vi.fn().mockReturnValue(TEST_IDS.companyId) } as unknown as ClsService;

    beforeEach(() => {
      // Accepts ROOT_A and the company-wide partition; rejects every other root.
      filter = {
        canGroup: vi.fn(async (params: { scope?: { id: string } }) => !params.scope || params.scope.id === ROOT_A.id),
      };
      filtered = new CommunityDetectorService(
        neo4jService as unknown as Neo4jService,
        logger as unknown as AppLoggingService,
        communityRepository as unknown as CommunityRepository,
        cls,
        catalog,
        scopePredicates,
        filter as unknown as CommunityScopeFilterInterface,
      );
      neo4jService.read.mockImplementation(async (query: string) => {
        if (query.includes("gds.version")) return { records: [{ get: () => "2.0" }] };
        if (query.includes("RETURN root.id AS id"))
          return { records: [{ get: () => ROOT_A.id }, { get: () => ROOT_B.id }] };
        if (query.includes("count(DISTINCT kc)")) return { records: [{ get: () => 5 }] };
        return { records: [] };
      });
      detectAtLevel = vi.spyOn(filtered as any, "detectCommunitiesAtLevel").mockResolvedValue([]);
    });

    it("detectCommunities skips scope roots the filter rejects", async () => {
      await filtered.detectCommunities();

      expect(filter.canGroup).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        scope: { id: ROOT_B.id, type: ROOT_B.type },
      });
      expect(detectAtLevel).toHaveBeenCalledTimes(1);
      expect(detectAtLevel).toHaveBeenCalledWith(1.0, 0, ROOT_A);
      // A rejected root keeps its communities: filtering a root out never deletes graph data.
      expect(communityRepository.deleteAllCommunities).not.toHaveBeenCalled();
      expect(communityRepository.deleteCommunitiesForScope).toHaveBeenCalledTimes(1);
      expect(communityRepository.deleteCommunitiesForScope).toHaveBeenCalledWith({ scope: ROOT_A });
    });

    it("detectCommunities does not fall back to company-wide when every root is rejected", async () => {
      filter.canGroup.mockResolvedValue(false);

      await filtered.detectCommunities();

      expect(detectAtLevel).not.toHaveBeenCalled();
      expect(communityRepository.deleteAllCommunities).not.toHaveBeenCalled();
    });

    describe("with no scope roots at all", () => {
      let unpartitioned: CommunityDetectorService;
      let detectAtLevelUnpartitioned: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        // No catalog: no scope roots, so detection uses the company-wide partition.
        unpartitioned = new CommunityDetectorService(
          neo4jService as unknown as Neo4jService,
          logger as unknown as AppLoggingService,
          communityRepository as unknown as CommunityRepository,
          cls,
          undefined,
          undefined,
          filter as unknown as CommunityScopeFilterInterface,
        );
        detectAtLevelUnpartitioned = vi.spyOn(unpartitioned as any, "detectCommunitiesAtLevel").mockResolvedValue([]);
      });

      it("runs the company-wide partition when the filter accepts the company", async () => {
        await unpartitioned.detectCommunities();

        expect(filter.canGroup).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
        expect(communityRepository.deleteAllCommunities).toHaveBeenCalledTimes(1);
        expect(detectAtLevelUnpartitioned).toHaveBeenCalledWith(1.0, 0, undefined);
      });

      it("does nothing when the filter rejects the company", async () => {
        filter.canGroup.mockResolvedValue(false);

        await unpartitioned.detectCommunities();

        expect(communityRepository.deleteAllCommunities).not.toHaveBeenCalled();
        expect(detectAtLevelUnpartitioned).not.toHaveBeenCalled();
      });
    });

    it("detectAndAssignCommunities does nothing for content whose scope root the filter rejects", async () => {
      vi.spyOn(filtered as any, "resolveScopeRootForContent").mockResolvedValue(ROOT_B);
      communityRepository.countByLevel.mockResolvedValue([]);

      await filtered.detectAndAssignCommunities(TEST_IDS.contentId, "ScopedItem");

      expect(communityRepository.countByLevel).not.toHaveBeenCalled();
      expect(communityRepository.findOrphanKeyConceptsForContent).not.toHaveBeenCalled();
      expect(detectAtLevel).not.toHaveBeenCalled();
    });

    it("detectAndAssignCommunities follows the company for content with no scope root", async () => {
      vi.spyOn(filtered as any, "resolveScopeRootForContent").mockResolvedValue(undefined);
      filter.canGroup.mockResolvedValue(false);

      await filtered.detectAndAssignCommunities(TEST_IDS.contentId, "Note");

      expect(filter.canGroup).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
      expect(communityRepository.countByLevel).not.toHaveBeenCalled();
    });

    it("detectAndAssignCommunities proceeds for content under an accepted root", async () => {
      vi.spyOn(filtered as any, "resolveScopeRootForContent").mockResolvedValue(ROOT_A);
      communityRepository.countByLevel.mockResolvedValue([{ level: 0, count: 2 }]);
      communityRepository.findOrphanKeyConceptsForContent.mockResolvedValue([]);

      await filtered.detectAndAssignCommunities(TEST_IDS.contentId, "ScopedItem");

      expect(communityRepository.findOrphanKeyConceptsForContent).toHaveBeenCalledWith(
        TEST_IDS.contentId,
        "ScopedItem",
      );
    });

    it("detectCommunitiesForScope deletes and rebuilds only that partition", async () => {
      await filtered.detectCommunitiesForScope({ scope: ROOT_B });

      expect(communityRepository.deleteCommunitiesForScope).toHaveBeenCalledTimes(1);
      expect(communityRepository.deleteCommunitiesForScope).toHaveBeenCalledWith({ scope: ROOT_B });
      expect(communityRepository.deleteAllCommunities).not.toHaveBeenCalled();
      expect(detectAtLevel).toHaveBeenCalledTimes(1);
      expect(detectAtLevel).toHaveBeenCalledWith(1.0, 0, ROOT_B);
    });
  });
});
