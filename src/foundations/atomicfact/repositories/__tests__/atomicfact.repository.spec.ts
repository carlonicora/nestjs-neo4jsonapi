import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { AtomicFactRepository } from "../atomicfact.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { AtomicFact } from "../../entities/atomic.fact.entity";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  atomicFactId: "770e8400-e29b-41d4-a716-446655440002",
  chunkId: "880e8400-e29b-41d4-a716-446655440003",
  keyConceptId: "990e8400-e29b-41d4-a716-446655440004",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  initQuery: vi.fn(),
});

const createMockSecurityService = () => ({
  userHasAccess: vi.fn((params: { validator: () => string }) => params.validator()),
  isCurrentUserCompanyAdmin: vi.fn().mockReturnValue(true),
});

const createMockClsService = () => ({
  has: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
});

describe("AtomicFactRepository", () => {
  let repository: AtomicFactRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let securityService: ReturnType<typeof createMockSecurityService>;
  let clsService: ReturnType<typeof createMockClsService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_ATOMIC_FACT: AtomicFact = {
    id: TEST_IDS.atomicFactId,
    content: "This is a test atomic fact",
    chunk: {
      id: TEST_IDS.chunkId,
      content: "Test chunk content",
      tokenCount: 100,
      createdAt: new Date("2025-01-01T00:00:00Z"),
      data: undefined as any,
    },
  };

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();
    securityService = createMockSecurityService();
    clsService = createMockClsService();

    // Default CLS context
    clsService.get.mockImplementation((key: string) => {
      if (key === "companyId") return TEST_IDS.companyId;
      if (key === "userId") return TEST_IDS.userId;
      return null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AtomicFactRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: SecurityService, useValue: securityService },
        { provide: ClsService, useValue: clsService },
      ],
    }).compile();

    repository = module.get<AtomicFactRepository>(AtomicFactRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query:
          "CREATE CONSTRAINT atomicfact_id IF NOT EXISTS FOR (atomicfact:AtomicFact) REQUIRE atomicfact.id IS UNIQUE",
      });
    });

    it("should handle constraint creation errors", async () => {
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("findAtomicFactsByKeyConcepts", () => {
    it("should find atomic facts by key concepts successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ATOMIC_FACT]);

      const params = {
        keyConcepts: ["concept1", "concept2"],
        skipChunkIds: [],
        skipAtomicFactIds: [],
        dataLimits: {},
      };

      const result = await repository.findAtomicFactsByKeyConcepts(params);

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(mockQuery.queryParams).toMatchObject({
        keyConcepts: params.keyConcepts,
        skipChunkIds: params.skipChunkIds,
        skipAtomicFactIds: params.skipAtomicFactIds,
      });
      expect(mockQuery.query).toContain("MATCH (data)-[:BELONGS_TO]->(company)");
      expect(mockQuery.query).toContain("MATCH (keyconcept:KeyConcept)");
      expect(mockQuery.query).toContain("WHERE keyconcept.value IN $keyConcepts");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_ATOMIC_FACT]);
    });

    it("should add skip chunk IDs clause when skipChunkIds is not empty", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ATOMIC_FACT]);

      const params = {
        keyConcepts: ["concept1"],
        skipChunkIds: [TEST_IDS.chunkId],
        skipAtomicFactIds: [],
        dataLimits: {},
      };

      await repository.findAtomicFactsByKeyConcepts(params);

      expect(mockQuery.query).toContain("AND NOT atomicfact_chunk.id IN $skipChunkIds");
    });

    it("should add skip atomic fact IDs clause when skipAtomicFactIds is not empty", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ATOMIC_FACT]);

      const params = {
        keyConcepts: ["concept1"],
        skipChunkIds: [],
        skipAtomicFactIds: [TEST_IDS.atomicFactId],
        dataLimits: {},
      };

      await repository.findAtomicFactsByKeyConcepts(params);

      expect(mockQuery.query).toContain("AND NOT atomicfact.id IN $skipAtomicFactIds");
    });

    it("should include both skip clauses when both arrays are not empty", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const params = {
        keyConcepts: ["concept1"],
        skipChunkIds: [TEST_IDS.chunkId],
        skipAtomicFactIds: [TEST_IDS.atomicFactId],
        dataLimits: {},
      };

      await repository.findAtomicFactsByKeyConcepts(params);

      expect(mockQuery.query).toContain("AND NOT atomicfact_chunk.id IN $skipChunkIds");
      expect(mockQuery.query).toContain("AND NOT atomicfact.id IN $skipAtomicFactIds");
    });

    it("should return empty array when no results found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const params = {
        keyConcepts: ["nonexistent"],
        skipChunkIds: [],
        skipAtomicFactIds: [],
        dataLimits: {},
      };

      const result = await repository.findAtomicFactsByKeyConcepts(params);

      expect(result).toEqual([]);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database connection error");
      neo4jService.readMany.mockRejectedValue(error);

      const params = {
        keyConcepts: ["concept1"],
        skipChunkIds: [],
        skipAtomicFactIds: [],
        dataLimits: {},
      };

      await expect(repository.findAtomicFactsByKeyConcepts(params)).rejects.toThrow("Database connection error");
    });
  });

  describe("findAtomicFactsByChunkId", () => {
    it("should find atomic facts by chunk ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ATOMIC_FACT]);

      const result = await repository.findAtomicFactsByChunkId({ chunkId: TEST_IDS.chunkId });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(mockQuery.queryParams).toMatchObject({
        chunkId: TEST_IDS.chunkId,
      });
      expect(mockQuery.query).toContain(
        "MATCH (chunk:Chunk {id: $chunkId})-[:HAS_ATOMIC_FACT]->(atomicfact: AtomicFact)",
      );
      expect(mockQuery.query).not.toContain("BELONGS_TO");
      expect(mockQuery.query).toContain("RETURN atomicfact");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_ATOMIC_FACT]);
    });

    it("should return empty array when chunk has no atomic facts", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findAtomicFactsByChunkId({ chunkId: "nonexistent" });

      expect(result).toEqual([]);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Query failed");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.findAtomicFactsByChunkId({ chunkId: TEST_IDS.chunkId })).rejects.toThrow("Query failed");
    });
  });

  describe("findAtomicFactById", () => {
    it("should find atomic fact by ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_ATOMIC_FACT);

      const result = await repository.findAtomicFactById({ atomicFactId: TEST_IDS.atomicFactId });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(mockQuery.queryParams).toMatchObject({
        atomicFactId: TEST_IDS.atomicFactId,
      });
      expect(mockQuery.query).toContain("MATCH (atomicfact: AtomicFact {id: $atomicFactId})");
      expect(mockQuery.query).not.toContain("BELONGS_TO");
      expect(mockQuery.query).toContain("RETURN atomicfact");
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_ATOMIC_FACT);
    });

    it("should return null when atomic fact not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findAtomicFactById({ atomicFactId: "nonexistent" });

      expect(result).toBeNull();
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Read operation failed");
      neo4jService.readOne.mockRejectedValue(error);

      await expect(repository.findAtomicFactById({ atomicFactId: TEST_IDS.atomicFactId })).rejects.toThrow(
        "Read operation failed",
      );
    });
  });

  describe("deleteDisconnectedAtomicFacts", () => {
    it("should delete disconnected atomic facts", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteDisconnectedAtomicFacts();

      expect(neo4jService.initQuery).toHaveBeenCalledWith();
      expect(mockQuery.query).toContain("MATCH (fact:AtomicFact)");
      expect(mockQuery.query).toContain("WHERE NOT (fact)<-[:HAS_ATOMIC_FACT]-()");
      expect(mockQuery.query).toContain("DETACH DELETE fact");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Delete operation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.deleteDisconnectedAtomicFacts()).rejects.toThrow("Delete operation failed");
    });

    it("should complete successfully when no disconnected facts exist", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const result = await repository.deleteDisconnectedAtomicFacts();

      expect(result).toBeUndefined();
      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("createAtomicFact", () => {
    it("should create atomic fact successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const params = {
        atomicFactId: TEST_IDS.atomicFactId,
        chunkId: TEST_IDS.chunkId,
        content: "New atomic fact content",
      };

      await repository.createAtomicFact(params);

      expect(neo4jService.initQuery).toHaveBeenCalledWith();
      expect(mockQuery.queryParams).toMatchObject({
        chunkId: params.chunkId,
        atomicFactId: params.atomicFactId,
        atomicFactContent: params.content,
      });
      expect(mockQuery.query).toContain("MATCH (chunk:Chunk {id: $chunkId})");
      expect(mockQuery.query).not.toContain("BELONGS_TO");
      expect(mockQuery.query).toContain("MERGE (atomicfact:AtomicFact {id: $atomicFactId})");
      expect(mockQuery.query).toContain("ON CREATE SET atomicfact.content = $atomicFactContent");
      expect(mockQuery.query).toContain("MERGE (chunk)-[:HAS_ATOMIC_FACT]->(atomicfact)");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle creation errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Creation failed - chunk not found");
      neo4jService.writeOne.mockRejectedValue(error);

      const params = {
        atomicFactId: TEST_IDS.atomicFactId,
        chunkId: "nonexistent",
        content: "Content",
      };

      await expect(repository.createAtomicFact(params)).rejects.toThrow("Creation failed - chunk not found");
    });

    it("should handle empty content", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const params = {
        atomicFactId: TEST_IDS.atomicFactId,
        chunkId: TEST_IDS.chunkId,
        content: "",
      };

      await repository.createAtomicFact(params);

      expect(mockQuery.queryParams.atomicFactContent).toBe("");
    });

    it("should handle special characters in content", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const specialContent = "This is a fact with 'quotes' and \"double quotes\" & special <chars>";
      const params = {
        atomicFactId: TEST_IDS.atomicFactId,
        chunkId: TEST_IDS.chunkId,
        content: specialContent,
      };

      await repository.createAtomicFact(params);

      expect(mockQuery.queryParams.atomicFactContent).toBe(specialContent);
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_ATOMIC_FACT);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";

      await repository.findAtomicFactById({ atomicFactId: exactId });

      expect(mockQuery.queryParams.atomicFactId).toBe(exactId);
    });

    it("should handle multiple key concepts", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const keyConcepts = ["concept1", "concept2", "concept3", "concept4", "concept5"];
      const params = {
        keyConcepts,
        skipChunkIds: [],
        skipAtomicFactIds: [],
        dataLimits: {},
      };

      await repository.findAtomicFactsByKeyConcepts(params);

      expect(mockQuery.queryParams.keyConcepts).toEqual(keyConcepts);
    });

    it("should handle very long content", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const longContent = "a".repeat(10000);
      const params = {
        atomicFactId: TEST_IDS.atomicFactId,
        chunkId: TEST_IDS.chunkId,
        content: longContent,
      };

      await repository.createAtomicFact(params);

      expect(mockQuery.queryParams.atomicFactContent).toBe(longContent);
    });
  });

  describe("Service Integration", () => {
    it("should call Neo4jService.initQuery before each read operation", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_ATOMIC_FACT);
      neo4jService.readMany.mockResolvedValue([MOCK_ATOMIC_FACT]);

      await repository.findAtomicFactById({ atomicFactId: TEST_IDS.atomicFactId });
      await repository.findAtomicFactsByChunkId({ chunkId: TEST_IDS.chunkId });
      await repository.findAtomicFactsByKeyConcepts({
        keyConcepts: ["concept1"],
        skipChunkIds: [],
        skipAtomicFactIds: [],
        dataLimits: {},
      });

      expect(neo4jService.initQuery).toHaveBeenCalledTimes(3);
    });

    it("should use ClsService to get userId", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findAtomicFactsByKeyConcepts({
        keyConcepts: ["concept1"],
        skipChunkIds: [],
        skipAtomicFactIds: [],
        dataLimits: {},
      });

      expect(clsService.get).toHaveBeenCalledWith("userId");
    });
  });
});
