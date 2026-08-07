import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { CommunityRepository } from "../community.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { ModelService } from "../../../../core/llm/services/model.service";
import { EmbedderService } from "../../../../core/llm/services/embedder.service";
import { Community } from "../../entities/community.entity";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  communityId: "770e8400-e29b-41d4-a716-446655440002",
  parentCommunityId: "880e8400-e29b-41d4-a716-446655440003",
  childCommunityId: "990e8400-e29b-41d4-a716-446655440004",
  keyConceptId1: "aa0e8400-e29b-41d4-a716-446655440005",
  keyConceptId2: "bb0e8400-e29b-41d4-a716-446655440006",
  contentId: "cc0e8400-e29b-41d4-a716-446655440007",
};

// Mock embedding vector
const MOCK_EMBEDDING = [0.1, 0.2, 0.3, 0.4, 0.5];

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  read: vi.fn(),
  initQuery: vi.fn(),
});

const createMockModelService = () => ({
  getEmbedderDimensions: vi.fn().mockReturnValue(1536),
});

const createMockEmbedderService = () => ({
  vectoriseText: vi.fn().mockResolvedValue(MOCK_EMBEDDING),
});

const createMockSecurityService = () => ({
  userHasAccess: vi.fn((params: { validator: () => string }) => params.validator()),
  isCurrentUserCompanyAdmin: vi.fn().mockReturnValue(true),
});

describe("CommunityRepository", () => {
  let repository: CommunityRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let modelService: ReturnType<typeof createMockModelService>;
  let embedderService: ReturnType<typeof createMockEmbedderService>;
  let securityService: ReturnType<typeof createMockSecurityService>;

  // `queryParams` mirrors what Neo4jService.initQuery() actually returns: it always
  // sets companyId, and binds the `company` Cypher variable ONLY when that id is
  // present. Tests asserting on the company edge must pass the id in explicitly.
  const createMockQuery = (queryParams: Record<string, any> = {}) => ({
    query: "",
    queryParams,
  });

  const MOCK_COMMUNITY: Community = {
    id: TEST_IDS.communityId,
    name: "Test Community",
    summary: "A test community summary",
    level: 1,
    rating: 0.85,
    memberCount: 5,
    isStale: false,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as Community;

  const MOCK_CHILD_COMMUNITY: Community = {
    id: TEST_IDS.childCommunityId,
    name: "Child Community",
    summary: "A child community",
    level: 0,
    rating: 0.75,
    memberCount: 3,
    isStale: false,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as Community;

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();
    modelService = createMockModelService();
    embedderService = createMockEmbedderService();
    securityService = createMockSecurityService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: ModelService, useValue: modelService },
        { provide: EmbedderService, useValue: embedderService },
        { provide: SecurityService, useValue: securityService },
      ],
    }).compile();

    repository = module.get<CommunityRepository>(CommunityRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: "CREATE CONSTRAINT community_id IF NOT EXISTS FOR (community:Community) REQUIRE community.id IS UNIQUE",
      });
    });

    it("should create vector index with embedder dimensions", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(modelService.getEmbedderDimensions).toHaveBeenCalled();
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("CREATE VECTOR INDEX communities IF NOT EXISTS"),
      });
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("1536"),
      });
    });

    it("should create both constraint and index", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
    });

    it("should handle errors", async () => {
      const error = new Error("Index creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Index creation failed");
    });
  });

  describe("createCommunity", () => {
    it("should create community with required fields", async () => {
      // companyId bound: initQuery() emits `MATCH (company:Company {id: $companyId})`,
      // so the BELONGS_TO edge has a real node to attach to.
      const mockQuery = createMockQuery({ companyId: TEST_IDS.companyId });
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_COMMUNITY);

      const result = await repository.createCommunity({
        name: "Test Community",
        level: 1,
        memberCount: 5,
      });

      expect(mockQuery.queryParams).toMatchObject({
        name: "Test Community",
        level: 1,
        memberCount: 5,
        rating: 0,
      });
      expect(mockQuery.queryParams.id).toBeDefined();
      expect(mockQuery.query).toContain("CREATE (community:Community");
      expect(mockQuery.query).toContain("CREATE (community)-[:BELONGS_TO]->(company)");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_COMMUNITY);
    });

    it("should create community with optional rating", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_COMMUNITY);

      await repository.createCommunity({
        name: "Test Community",
        level: 1,
        memberCount: 5,
        rating: 0.9,
      });

      expect(mockQuery.queryParams.rating).toBe(0.9);
    });

    it("should generate UUID for new community", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_COMMUNITY);

      await repository.createCommunity({
        name: "Test Community",
        level: 1,
        memberCount: 5,
      });

      expect(mockQuery.queryParams.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("should set isStale to true on creation", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_COMMUNITY);

      await repository.createCommunity({
        name: "Test Community",
        level: 1,
        memberCount: 5,
      });

      expect(mockQuery.query).toContain("isStale: true");
    });
  });

  describe("updateCommunityMembers", () => {
    it("should remove existing and add new members", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.updateCommunityMembers({
        communityId: TEST_IDS.communityId,
        keyConceptIds: [TEST_IDS.keyConceptId1, TEST_IDS.keyConceptId2],
      });

      // Should be called 3 times: delete, add, update count
      expect(neo4jService.writeOne).toHaveBeenCalledTimes(3);
    });

    it("should only remove members when keyConceptIds is empty", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.updateCommunityMembers({
        communityId: TEST_IDS.communityId,
        keyConceptIds: [],
      });

      // Should be called only 1 time: delete only
      expect(neo4jService.writeOne).toHaveBeenCalledTimes(1);
      expect(mockQuery.query).toContain("DELETE r");
    });

    it("should update memberCount when adding members", async () => {
      let callCount = 0;
      neo4jService.initQuery.mockImplementation(() => {
        callCount++;
        return createMockQuery();
      });
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.updateCommunityMembers({
        communityId: TEST_IDS.communityId,
        keyConceptIds: [TEST_IDS.keyConceptId1, TEST_IDS.keyConceptId2],
      });

      expect(callCount).toBe(3);
    });
  });

  describe("setParentCommunity", () => {
    it("should create PARENT_OF relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.setParentCommunity({
        childCommunityId: TEST_IDS.childCommunityId,
        parentCommunityId: TEST_IDS.parentCommunityId,
      });

      expect(mockQuery.queryParams).toMatchObject({
        childCommunityId: TEST_IDS.childCommunityId,
        parentCommunityId: TEST_IDS.parentCommunityId,
      });
      expect(mockQuery.query).toContain("MERGE (parent)-[:PARENT_OF]->(child)");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("markAsStale", () => {
    it("should mark communities as stale", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const communityIds = [TEST_IDS.communityId, TEST_IDS.childCommunityId];
      await repository.markAsStale(communityIds);

      expect(mockQuery.queryParams.communityIds).toEqual(communityIds);
      expect(mockQuery.query).toContain("SET community.isStale = true");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should do nothing when communityIds is empty", async () => {
      await repository.markAsStale([]);

      expect(neo4jService.initQuery).not.toHaveBeenCalled();
      expect(neo4jService.writeOne).not.toHaveBeenCalled();
    });
  });

  describe("findAllStaleCommunities", () => {
    it("should find all stale communities with their company IDs", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            if (key === "communityId") return TEST_IDS.communityId;
            if (key === "companyId") return TEST_IDS.companyId;
            return null;
          }),
        },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.findAllStaleCommunities();

      expect(mockQuery.query).toContain("community:Community {isStale: true}");
      expect(mockQuery.query).toContain("ORDER BY community.staleSince ASC");
      expect(result).toEqual([{ communityId: TEST_IDS.communityId, companyId: TEST_IDS.companyId }]);
    });

    it("should return empty array when no stale communities found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      const result = await repository.findAllStaleCommunities();

      expect(result).toEqual([]);
    });
  });

  describe("updateSummary", () => {
    it("should update community summary and embedding", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.updateSummary({
        communityId: TEST_IDS.communityId,
        name: "Updated Name",
        summary: "Updated summary",
        embedding: MOCK_EMBEDDING,
        rating: 0.95,
      });

      expect(mockQuery.queryParams).toMatchObject({
        communityId: TEST_IDS.communityId,
        name: "Updated Name",
        summary: "Updated summary",
        embedding: MOCK_EMBEDDING,
        rating: 0.95,
      });
      expect(mockQuery.query).toContain("SET community.name = $name");
      expect(mockQuery.query).toContain("community.isStale = false");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("findByVector", () => {
    it("should find communities by vector similarity", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_COMMUNITY]);

      const result = await repository.findByVector({
        embedding: MOCK_EMBEDDING,
        topK: 5,
      });

      expect(mockQuery.queryParams.embedding).toEqual(MOCK_EMBEDDING);
      expect(mockQuery.queryParams.topK).toBe(5);
      expect(mockQuery.query).toContain("db.index.vector.queryNodes");
      expect(mockQuery.query).toContain("ORDER BY score DESC");
      expect(result).toEqual([MOCK_COMMUNITY]);
    });

    it("should filter by level when provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_COMMUNITY]);

      await repository.findByVector({
        embedding: MOCK_EMBEDDING,
        topK: 5,
        level: 1,
      });

      expect(mockQuery.queryParams.level).toBe(1);
      expect(mockQuery.query).toContain("community.level = $level");
    });

    it("should not filter by level when not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_COMMUNITY]);

      await repository.findByVector({
        embedding: MOCK_EMBEDDING,
        topK: 5,
      });

      expect(mockQuery.queryParams.level).toBeUndefined();
    });
  });

  describe("findByLevel", () => {
    it("should find communities by level", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_COMMUNITY]);

      const result = await repository.findByLevel({ level: 1 });

      expect(mockQuery.queryParams.level).toBe(1);
      expect(mockQuery.query).toContain("WHERE community.level = $level");
      expect(mockQuery.query).toContain("ORDER BY community.rating DESC");
      expect(result).toEqual([MOCK_COMMUNITY]);
    });
  });

  describe("findMemberKeyConcepts", () => {
    it("should find member key concepts", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            if (key === "id") return TEST_IDS.keyConceptId1;
            if (key === "value") return "Concept 1";
            if (key === "description") return "Description 1";
            return null;
          }),
        },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.findMemberKeyConcepts(TEST_IDS.communityId);

      expect(mockQuery.queryParams.communityId).toBe(TEST_IDS.communityId);
      expect(mockQuery.query).toContain("[:HAS_MEMBER]->(keyconcept:KeyConcept)");
      expect(result).toEqual([{ id: TEST_IDS.keyConceptId1, value: "Concept 1", description: "Description 1" }]);
    });

    it("should handle null description", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            if (key === "id") return TEST_IDS.keyConceptId1;
            if (key === "value") return "Concept 1";
            if (key === "description") return null;
            return null;
          }),
        },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.findMemberKeyConcepts(TEST_IDS.communityId);

      expect(result[0].description).toBeUndefined();
    });
  });

  describe("findMemberRelationships", () => {
    it("should find relationships between members", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            if (key === "keyConcept1") return "Concept A";
            if (key === "keyConcept2") return "Concept B";
            if (key === "weight") return 0.85;
            return null;
          }),
        },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.findMemberRelationships(TEST_IDS.communityId);

      expect(mockQuery.queryParams.communityId).toBe(TEST_IDS.communityId);
      expect(mockQuery.query).toContain("KeyConceptRelationship");
      expect(result).toEqual([{ keyConcept1: "Concept A", keyConcept2: "Concept B", weight: 0.85 }]);
    });

    it("should handle Neo4j Integer weights with toNumber()", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            if (key === "keyConcept1") return "Concept A";
            if (key === "keyConcept2") return "Concept B";
            if (key === "weight") return { toNumber: () => 1.5 };
            return null;
          }),
        },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.findMemberRelationships(TEST_IDS.communityId);

      expect(result[0].weight).toBe(1.5);
    });

    it("should default weight to 1.0 when null", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            if (key === "keyConcept1") return "Concept A";
            if (key === "keyConcept2") return "Concept B";
            if (key === "weight") return null;
            return null;
          }),
        },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.findMemberRelationships(TEST_IDS.communityId);

      expect(result[0].weight).toBe(1.0);
    });
  });

  describe("getHierarchy", () => {
    it("should get parent community chain", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_COMMUNITY]);

      const result = await repository.getHierarchy(TEST_IDS.communityId);

      expect(mockQuery.queryParams.communityId).toBe(TEST_IDS.communityId);
      expect(mockQuery.query).toContain("[:PARENT_OF*]->(child)");
      expect(mockQuery.query).toContain("ORDER BY community.level DESC");
      expect(result).toEqual([MOCK_COMMUNITY]);
    });
  });

  describe("getChildren", () => {
    it("should get child communities", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CHILD_COMMUNITY]);

      const result = await repository.getChildren(TEST_IDS.communityId);

      expect(mockQuery.queryParams.communityId).toBe(TEST_IDS.communityId);
      expect(mockQuery.query).toContain("-[:PARENT_OF]->(child:Community)");
      expect(mockQuery.query).toContain("ORDER BY child.rating DESC");
      expect(result).toEqual([MOCK_CHILD_COMMUNITY]);
    });
  });

  describe("deleteCommunity", () => {
    it("should delete community by ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteCommunity(TEST_IDS.communityId);

      expect(mockQuery.queryParams.communityId).toBe(TEST_IDS.communityId);
      expect(mockQuery.query).toContain("DETACH DELETE community");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("deleteAllCommunities", () => {
    it("should delete all communities for company", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteAllCommunities();

      expect(mockQuery.query).toContain("[:BELONGS_TO]->(company)");
      expect(mockQuery.query).toContain("DETACH DELETE community");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("findCommunitiesByKeyConcept", () => {
    it("should find communities containing a key concept", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_COMMUNITY]);

      const result = await repository.findCommunitiesByKeyConcept(TEST_IDS.keyConceptId1);

      expect(mockQuery.queryParams.keyConceptId).toBe(TEST_IDS.keyConceptId1);
      expect(mockQuery.query).toContain("[:HAS_MEMBER]->(keyconcept:KeyConcept {id: $keyConceptId})");
      expect(mockQuery.query).toContain("ORDER BY community.level ASC");
      expect(result).toEqual([MOCK_COMMUNITY]);
    });
  });

  describe("countByLevel", () => {
    it("should count communities by level", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            if (key === "level") return 1;
            if (key === "count") return 5;
            return null;
          }),
        },
        {
          get: vi.fn((key: string) => {
            if (key === "level") return 2;
            if (key === "count") return 3;
            return null;
          }),
        },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.countByLevel();

      expect(mockQuery.query).toContain("COUNT(community) AS count");
      expect(mockQuery.query).toContain("ORDER BY level ASC");
      expect(result).toEqual([
        { level: 1, count: 5 },
        { level: 2, count: 3 },
      ]);
    });

    it("should handle Neo4j Integer values with toNumber()", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            if (key === "level") return { toNumber: () => 1 };
            if (key === "count") return { toNumber: () => 10 };
            return null;
          }),
        },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.countByLevel();

      expect(result[0]).toEqual({ level: 1, count: 10 });
    });
  });

  describe("findById", () => {
    it("should find community by ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_COMMUNITY);

      const result = await repository.findById(TEST_IDS.communityId);

      expect(mockQuery.queryParams.communityId).toBe(TEST_IDS.communityId);
      expect(mockQuery.query).toContain("Community {id: $communityId}");
      expect(mockQuery.query).toContain("[:BELONGS_TO]->(company)");
      expect(result).toEqual(MOCK_COMMUNITY);
    });

    it("should return null when community not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findCommunitiesByRelatedKeyConcepts", () => {
    it("should find communities by related key concepts with affinity scores", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            if (key === "communityId") return TEST_IDS.communityId;
            if (key === "memberCount") return 5;
            if (key === "relationshipCount") return 3;
            if (key === "totalWeight") return 2.5;
            return null;
          }),
        },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.findCommunitiesByRelatedKeyConcepts(TEST_IDS.keyConceptId1);

      expect(mockQuery.queryParams.keyConceptId).toBe(TEST_IDS.keyConceptId1);
      expect(mockQuery.query).toContain("KeyConceptRelationship");
      expect(mockQuery.query).toContain("ORDER BY totalWeight DESC");
      expect(result).toEqual([
        {
          communityId: TEST_IDS.communityId,
          memberCount: 5,
          relationshipCount: 3,
          totalWeight: 2.5,
        },
      ]);
    });

    it("should handle Neo4j Integer values", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            if (key === "communityId") return TEST_IDS.communityId;
            if (key === "memberCount") return { toNumber: () => 10 };
            if (key === "relationshipCount") return { toNumber: () => 5 };
            if (key === "totalWeight") return { toNumber: () => 3.5 };
            return null;
          }),
        },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.findCommunitiesByRelatedKeyConcepts(TEST_IDS.keyConceptId1);

      expect(result[0]).toEqual({
        communityId: TEST_IDS.communityId,
        memberCount: 10,
        relationshipCount: 5,
        totalWeight: 3.5,
      });
    });
  });

  describe("addMemberToCommunity", () => {
    it("should add member to community", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.addMemberToCommunity(TEST_IDS.communityId, TEST_IDS.keyConceptId1);

      expect(mockQuery.queryParams).toMatchObject({
        communityId: TEST_IDS.communityId,
        keyConceptId: TEST_IDS.keyConceptId1,
      });
      expect(mockQuery.query).toContain("MERGE (community)-[:HAS_MEMBER]->(keyconcept)");
      expect(mockQuery.query).toContain("community.memberCount = community.memberCount + 1");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("findOrphanKeyConceptsForContent", () => {
    it("should find orphan key concepts for content", async () => {
      const mockRecords = [
        { get: vi.fn().mockReturnValue(TEST_IDS.keyConceptId1) },
        { get: vi.fn().mockReturnValue(TEST_IDS.keyConceptId2) },
      ];
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.findOrphanKeyConceptsForContent(TEST_IDS.contentId, "Content");

      expect(mockQuery.queryParams.contentId).toBe(TEST_IDS.contentId);
      expect(mockQuery.query).toContain("content:Content {id: $contentId}");
      expect(mockQuery.query).toContain("NOT EXISTS { (kc)<-[:HAS_MEMBER]-(:Community) }");
      expect(result).toEqual([TEST_IDS.keyConceptId1, TEST_IDS.keyConceptId2]);
    });

    it("should return empty array when no orphans found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      const result = await repository.findOrphanKeyConceptsForContent(TEST_IDS.contentId, "Content");

      expect(result).toEqual([]);
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_COMMUNITY);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.findById(exactId);

      expect(mockQuery.queryParams.communityId).toBe(exactId);
    });

    it("should handle special characters in community name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(MOCK_COMMUNITY);

      const specialName = "Community with 'quotes' and \"double quotes\" & special <chars>";
      await repository.createCommunity({
        name: specialName,
        level: 1,
        memberCount: 0,
      });

      expect(mockQuery.queryParams.name).toBe(specialName);
    });

    it("should handle very long summary in updateSummary", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const longSummary = "a".repeat(10000);
      await repository.updateSummary({
        communityId: TEST_IDS.communityId,
        name: "Test",
        summary: longSummary,
        embedding: MOCK_EMBEDDING,
        rating: 0.5,
      });

      expect(mockQuery.queryParams.summary).toBe(longSummary);
    });
  });
});
