import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { KeyConceptRepository } from "../keyconcept.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { ModelService } from "../../../../core/llm/services/model.service";
import { EmbedderService } from "../../../../core/llm/services/embedder.service";
import { KeyConcept } from "../../entities/key.concept.entity";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  keyConceptId1: "770e8400-e29b-41d4-a716-446655440002",
  keyConceptId2: "880e8400-e29b-41d4-a716-446655440003",
  atomicFactId: "990e8400-e29b-41d4-a716-446655440004",
  chunkId: "aa0e8400-e29b-41d4-a716-446655440005",
};

// Mock embedding vector
const MOCK_EMBEDDING = [0.1, 0.2, 0.3, 0.4, 0.5];

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  initQuery: vi.fn(),
  executeInTransaction: vi.fn(),
});

const createMockModelService = () => ({
  getEmbedderDimensions: vi.fn().mockReturnValue(1536),
});

const createMockEmbedderService = () => ({
  vectoriseText: vi.fn().mockResolvedValue(MOCK_EMBEDDING),
  vectoriseTextBatch: vi.fn().mockResolvedValue([MOCK_EMBEDDING, MOCK_EMBEDDING]),
});

const createMockSecurityService = () => ({
  userHasAccess: vi.fn(({ validator }: { validator: () => string }) => validator()),
  isCurrentUserCompanyAdmin: vi.fn().mockReturnValue(true),
});

const createMockClsService = () => ({
  has: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
});

describe("KeyConceptRepository", () => {
  let repository: KeyConceptRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let modelService: ReturnType<typeof createMockModelService>;
  let embedderService: ReturnType<typeof createMockEmbedderService>;
  let securityService: ReturnType<typeof createMockSecurityService>;
  let clsService: ReturnType<typeof createMockClsService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_KEY_CONCEPT: KeyConcept = {
    id: TEST_IDS.keyConceptId1,
    value: "Test Concept",
    description: "A test key concept",
    embedding: MOCK_EMBEDDING,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as KeyConcept;

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();
    modelService = createMockModelService();
    embedderService = createMockEmbedderService();
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
        KeyConceptRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: ModelService, useValue: modelService },
        { provide: EmbedderService, useValue: embedderService },
        { provide: SecurityService, useValue: securityService },
        { provide: ClsService, useValue: clsService },
      ],
    }).compile();

    repository = module.get<KeyConceptRepository>(KeyConceptRepository);
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
          "CREATE CONSTRAINT keyconcept_id IF NOT EXISTS FOR (keyconcept:KeyConcept) REQUIRE keyconcept.id IS UNIQUE",
      });
    });

    it("should create unique constraint on value field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query:
          "CREATE CONSTRAINT keyconcept_value IF NOT EXISTS FOR (keyconcept:KeyConcept) REQUIRE keyconcept.value IS UNIQUE",
      });
    });

    it("should create vector index with embedder dimensions", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(modelService.getEmbedderDimensions).toHaveBeenCalled();
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("CREATE VECTOR INDEX keyconcepts IF NOT EXISTS"),
      });
    });

    it("should create all three constraints/indexes", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(3);
    });

    it("should handle errors", async () => {
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("findPotentialKeyConcepts", () => {
    it("should find potential key concepts using vector search", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_KEY_CONCEPT]);

      const result = await repository.findPotentialKeyConcepts({
        question: "test question",
        dataLimits: {},
      });

      expect(embedderService.vectoriseText).toHaveBeenCalledWith({ text: "test question" });
      expect(mockQuery.queryParams.queryEmbedding).toEqual(MOCK_EMBEDDING);
      expect(mockQuery.query).toContain("db.index.vector.queryNodes");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_KEY_CONCEPT]);
    });

    it("should return empty array when no key concepts found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findPotentialKeyConcepts({
        question: "nonexistent topic",
        dataLimits: {},
      });

      expect(result).toEqual([]);
    });

    it("should handle embedding errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      embedderService.vectoriseText.mockRejectedValue(new Error("Embedding failed"));

      await expect(
        repository.findPotentialKeyConcepts({
          question: "test",
          dataLimits: {},
        }),
      ).rejects.toThrow("Embedding failed");
    });
  });

  describe("findKeyConceptByValue", () => {
    it("should find key concept by value", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_KEY_CONCEPT);

      const result = await repository.findKeyConceptByValue({ keyConceptValue: "Test Concept" });

      expect(mockQuery.queryParams.keyConceptValue).toBe("Test Concept");
      expect(mockQuery.query).toContain("value: $keyConceptValue");
      expect(neo4jService.readOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_KEY_CONCEPT);
    });

    it("should return null when key concept not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findKeyConceptByValue({ keyConceptValue: "nonexistent" });

      expect(result).toBeNull();
    });
  });

  describe("findKeyConceptsByValues", () => {
    it("should find key concepts by values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_KEY_CONCEPT]);

      const result = await repository.findKeyConceptsByValues({
        keyConceptValues: ["Concept 1", "Concept 2"],
      });

      expect(mockQuery.queryParams.keyConceptValues).toEqual(["Concept 1", "Concept 2"]);
      expect(mockQuery.query).toContain("keyconcept.value IN $keyConceptValues");
      expect(mockQuery.query).toContain("keyconcept.embedding IS NOT NULL");
      expect(result).toEqual([MOCK_KEY_CONCEPT]);
    });

    it("should return empty array when no matching concepts found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findKeyConceptsByValues({
        keyConceptValues: ["nonexistent"],
      });

      expect(result).toEqual([]);
    });
  });

  describe("createKeyConcept", () => {
    it("should create new key concept with embedding when it does not exist", async () => {
      const mockCheckQuery = createMockQuery();
      const mockCreateQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(mockCheckQuery).mockReturnValueOnce(mockCreateQuery);
      neo4jService.readMany.mockResolvedValue([]);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createKeyConcept({
        keyConceptValue: "New Concept",
        atomicFactId: TEST_IDS.atomicFactId,
      });

      expect(embedderService.vectoriseText).toHaveBeenCalledWith({ text: "New Concept" });
      expect(mockCreateQuery.queryParams.keyConceptValue).toBe("New Concept");
      expect(mockCreateQuery.queryParams.atomicFactId).toBe(TEST_IDS.atomicFactId);
      expect(mockCreateQuery.queryParams.vector).toEqual(MOCK_EMBEDDING);
      expect(mockCreateQuery.query).toContain("MERGE (keyconcept: KeyConcept");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockCreateQuery);
    });

    it("should not create embedding when key concept already exists", async () => {
      const mockCheckQuery = createMockQuery();
      const mockCreateQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValueOnce(mockCheckQuery).mockReturnValueOnce(mockCreateQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_KEY_CONCEPT]);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createKeyConcept({
        keyConceptValue: "Existing Concept",
        atomicFactId: TEST_IDS.atomicFactId,
      });

      expect(embedderService.vectoriseText).not.toHaveBeenCalled();
      expect(mockCreateQuery.queryParams.vector).toBeNull();
    });
  });

  describe("createKeyConceptRelation", () => {
    it("should create relationship between atomic fact and key concept", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createKeyConceptRelation({
        keyConceptValue: "Test Concept",
        atomicFactId: TEST_IDS.atomicFactId,
      });

      expect(mockQuery.queryParams.keyConceptValue).toBe("Test Concept");
      expect(mockQuery.queryParams.atomicFactId).toBe(TEST_IDS.atomicFactId);
      expect(mockQuery.query).toContain("MERGE (atomicfact)-[:HAS_KEY_CONCEPT]->(keyconcept)");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("createOrphanKeyConcepts", () => {
    it("should create orphan key concepts with embeddings", async () => {
      neo4jService.executeInTransaction.mockResolvedValue(undefined);

      await repository.createOrphanKeyConcepts({
        keyConceptValues: ["Concept 1", "Concept 2"],
      });

      expect(embedderService.vectoriseTextBatch).toHaveBeenCalledWith(["Concept 1", "Concept 2"]);
      expect(neo4jService.executeInTransaction).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            query: expect.stringContaining("MERGE (keyconcept: KeyConcept"),
            params: expect.objectContaining({
              keyConceptId: "Concept 1",
            }),
          }),
        ]),
      );
    });
  });

  describe("updateKeyConceptDescriptions", () => {
    it("should update descriptions for key concepts", async () => {
      neo4jService.executeInTransaction.mockResolvedValue(undefined);

      await repository.updateKeyConceptDescriptions({
        descriptions: [
          { keyConcept: "Concept 1", description: "Description 1" },
          { keyConcept: "Concept 2", description: "Description 2" },
        ],
      });

      expect(neo4jService.executeInTransaction).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            params: expect.objectContaining({
              keyConceptValue: "Concept 1",
              description: "Description 1",
            }),
          }),
        ]),
      );
    });

    it("should do nothing when descriptions array is empty", async () => {
      await repository.updateKeyConceptDescriptions({ descriptions: [] });

      expect(neo4jService.executeInTransaction).not.toHaveBeenCalled();
    });
  });

  describe("deleteDisconnectedKeyConcepts", () => {
    it("should delete disconnected key concepts and orphan relationships", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteDisconnectedKeyConcepts();

      // Should be called twice: once for key concepts, once for relationships
      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
    });

    it("should include proper deletion queries", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteDisconnectedKeyConcepts();

      expect(mockQuery.query).toContain("DETACH DELETE keyconcept");
    });
  });

  describe("createOrUpdateKeyConceptRelationships", () => {
    const relationships = [
      { keyConcept1: "alpha", keyConcept2: "beta", relationship: "RELATED_TO" },
    ];

    it("scopes the relationship to the company when companyId is provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createOrUpdateKeyConceptRelationships({
        companyId: TEST_IDS.companyId,
        chunkId: TEST_IDS.chunkId,
        relationships,
      });

      expect(mockQuery.queryParams).toMatchObject({ companyId: TEST_IDS.companyId });
      expect(mockQuery.query).toContain("MATCH (company:Company {id: $companyId})");
      expect(mockQuery.query).toContain("MERGE (rel)-[:BELONGS_TO]->(company)");
    });

    it("creates a global relationship (no BELONGS_TO) when companyId is omitted (HowTo case)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createOrUpdateKeyConceptRelationships({
        chunkId: TEST_IDS.chunkId,
        relationships,
      });

      expect(mockQuery.queryParams).not.toHaveProperty("companyId");
      expect(mockQuery.query).not.toContain("BELONGS_TO");
      expect(mockQuery.query).not.toContain("Company");
      expect(mockQuery.query).toContain("MERGE (rel:KeyConceptRelationship");
      expect(mockQuery.query).toContain("MERGE (rel)-[:RELATES_TO]->(keyConcept1)");
      expect(mockQuery.query).toContain("MERGE (rel)-[:OCCURS_IN]->(chunk)");
    });
  });

  describe("resizeKeyConceptRelationshipsWeightOnChunkDeletion", () => {
    it("should decrease weight and cleanup relationships", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.resizeKeyConceptRelationshipsWeightOnChunkDeletion({
        chunkId: TEST_IDS.chunkId,
      });

      expect(mockQuery.queryParams.chunkId).toBe(TEST_IDS.chunkId);
      expect(mockQuery.query).toContain("SET rel.weight = rel.weight - 1");
      expect(mockQuery.query).toContain("DELETE occursIn");
      expect(mockQuery.query).toContain("DETACH DELETE rel");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("findNeighboursByKeyConcepts", () => {
    it("should find neighboring key concepts", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_KEY_CONCEPT]);

      const result = await repository.findNeighboursByKeyConcepts({
        keyConcepts: ["Concept 1", "Concept 2"],
        dataLimits: {},
      });

      expect(mockQuery.queryParams.keyConcepts).toEqual(["Concept 1", "Concept 2"]);
      expect(mockQuery.query).toContain("KeyConceptRelationship");
      expect(mockQuery.query).toContain(":RELATES_TO");
      expect(result).toEqual([MOCK_KEY_CONCEPT]);
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.createKeyConceptRelation({
        keyConceptValue: "Test",
        atomicFactId: exactId,
      });

      expect(mockQuery.queryParams.atomicFactId).toBe(exactId);
    });

    it("should handle special characters in key concept values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const specialValue = "Concept with 'quotes' and \"double quotes\"";
      await repository.findKeyConceptByValue({ keyConceptValue: specialValue });

      expect(mockQuery.queryParams.keyConceptValue).toBe(specialValue);
    });
  });
});
