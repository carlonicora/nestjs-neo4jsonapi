import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { ChunkRepository } from "../chunk.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { AI_SOURCE_QUERY } from "../../../../common/repositories/ai-source-query.provider";
import { ModelService } from "../../../../core/llm/services/model.service";
import { EmbedderService } from "../../../../core/llm/services/embedder.service";
import { Chunk } from "../../entities/chunk.entity";
import { AiStatus } from "../../../../common/enums/ai.status";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  chunkId: "770e8400-e29b-41d4-a716-446655440002",
  nextChunkId: "880e8400-e29b-41d4-a716-446655440003",
  contentId: "990e8400-e29b-41d4-a716-446655440004",
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

const createMockClsService = () => ({
  has: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
});

describe("ChunkRepository", () => {
  let repository: ChunkRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let modelService: ReturnType<typeof createMockModelService>;
  let embedderService: ReturnType<typeof createMockEmbedderService>;
  let securityService: ReturnType<typeof createMockSecurityService>;
  let clsService: ReturnType<typeof createMockClsService>;
  let aiSourceQueryBuild: ReturnType<typeof vi.fn>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_CHUNK: Chunk = {
    id: TEST_IDS.chunkId,
    content: "Test chunk content",
    tokenCount: 100,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    data: {
      id: TEST_IDS.contentId,
      type: "Content",
    } as any,
  };

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

    // The AI_SOURCE_QUERY seam: a captured spy so tests can assert how it is invoked.
    aiSourceQueryBuild = vi.fn(() => ({
      cypher: "MATCH (data)-[:BELONGS_TO]->(company) WITH data",
      params: {},
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChunkRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: ModelService, useValue: modelService },
        { provide: EmbedderService, useValue: embedderService },
        { provide: SecurityService, useValue: securityService },
        { provide: ClsService, useValue: clsService },
        {
          provide: AI_SOURCE_QUERY,
          useValue: { build: aiSourceQueryBuild },
        },
      ],
    }).compile();

    repository = module.get<ChunkRepository>(ChunkRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: "CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (chunk:Chunk) REQUIRE chunk.id IS UNIQUE",
      });
    });

    it("should create vector index with embedder dimensions", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(modelService.getEmbedderDimensions).toHaveBeenCalled();
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("CREATE VECTOR INDEX chunks IF NOT EXISTS"),
      });
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("1536"),
      });
    });

    it("should create both constraint and index", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      // constraint + vector index + fulltext index (chunk_content_search) = 3
      expect(neo4jService.writeOne).toHaveBeenCalledTimes(3);
    });

    it("should handle errors", async () => {
      const error = new Error("Index creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Index creation failed");
    });
  });

  // Hybrid retrieval (Task 1): scope id-set via the AI_SOURCE_QUERY provider, then a
  // vector branch + a lexical (fulltext) branch, fused with reciprocal rank fusion.
  describe("findPotentialChunks (hybrid retrieval)", () => {
    const makeRecord = (key: string, value: unknown) => ({
      get: (k: string) => (k === key ? value : undefined),
    });

    const SCOPE_CHUNK_IDS = ["c1", "c2", "c3"];
    const chunkC1: Chunk = { ...MOCK_CHUNK, id: "c1" };
    const chunkC2: Chunk = { ...MOCK_CHUNK, id: "c2" };
    const chunkC3: Chunk = { ...MOCK_CHUNK, id: "c3" };

    // Wire the three reads (scope id-set, vector branch, lexical branch) plus the
    // final ordered hydration via readMany.
    const wireHybridReads = () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.read
        .mockResolvedValueOnce({ records: [makeRecord("chunkIds", SCOPE_CHUNK_IDS)] })
        .mockResolvedValueOnce({ records: [makeRecord("id", "c1"), makeRecord("id", "c2")] })
        .mockResolvedValueOnce({ records: [makeRecord("id", "c2"), makeRecord("id", "c3")] });
      neo4jService.readMany.mockResolvedValue([chunkC1, chunkC2, chunkC3]);
    };

    it("derives the access-scoped id-set from the AI_SOURCE_QUERY provider", async () => {
      wireHybridReads();

      await repository.findPotentialChunks({ question: "test question", dataLimits: {} });

      expect(embedderService.vectoriseText).toHaveBeenCalledWith({ text: "test question" });
      expect(aiSourceQueryBuild).toHaveBeenCalledWith(expect.objectContaining({ returnsData: true }));

      const scopeReadQuery = neo4jService.read.mock.calls[0][0] as string;
      expect(scopeReadQuery).toContain("MATCH (data)-[:BELONGS_TO]->(company) WITH data");
      expect(scopeReadQuery).toContain("MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(data)");
      expect(scopeReadQuery).toContain("RETURN COLLECT(DISTINCT chunk.id) AS chunkIds");
    });

    it("runs the vector branch scoped to the id-set", async () => {
      wireHybridReads();

      await repository.findPotentialChunks({ question: "test question", dataLimits: {} });

      const [vectorQuery, vectorParams] = neo4jService.read.mock.calls[1] as [string, Record<string, unknown>];
      expect(vectorQuery).toContain("db.index.vector.queryNodes('chunks'");
      expect(vectorParams.queryEmbedding).toEqual(MOCK_EMBEDDING);
      expect(vectorParams.chunkIds).toEqual(SCOPE_CHUNK_IDS);
    });

    it("runs the lexical branch with an escaped fulltext term scoped to the id-set", async () => {
      wireHybridReads();

      await repository.findPotentialChunks({ question: "contract (terms)?", dataLimits: {} });

      const [lexicalQuery, lexicalParams] = neo4jService.read.mock.calls[2] as [string, Record<string, unknown>];
      expect(lexicalQuery).toContain("db.index.fulltext.queryNodes('chunk_content_search'");
      expect(lexicalParams.chunkIds).toEqual(SCOPE_CHUNK_IDS);
      // Lucene special characters are escaped so a user question cannot break the query.
      expect(lexicalParams.term).toContain("\\(");
      expect(lexicalParams.term).toContain("\\?");
    });

    it("fuses the vector + lexical rankings (RRF) and returns chunks in fused order", async () => {
      wireHybridReads();

      const result = await repository.findPotentialChunks({ question: "test question", dataLimits: {} });

      // vector=[c1,c2], lexical=[c2,c3] => RRF rewards the shared c2 first, then c1, then c3.
      expect(result.map((chunk) => chunk.id)).toEqual(["c2", "c1", "c3"]);
      expect(neo4jService.read).toHaveBeenCalledTimes(3);
      expect(neo4jService.readMany).toHaveBeenCalledTimes(1);
    });

    it("returns an empty array when the scope yields no chunks (no vector/lexical reads)", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.read.mockResolvedValueOnce({ records: [makeRecord("chunkIds", [])] });

      const result = await repository.findPotentialChunks({ question: "nothing", dataLimits: {} });

      expect(result).toEqual([]);
      expect(neo4jService.read).toHaveBeenCalledTimes(1);
      expect(neo4jService.readMany).not.toHaveBeenCalled();
    });

    it("propagates embedding errors", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      embedderService.vectoriseText.mockRejectedValue(new Error("Embedding failed"));

      await expect(repository.findPotentialChunks({ question: "test", dataLimits: {} })).rejects.toThrow(
        "Embedding failed",
      );
    });
  });

  describe("findSubsequentChunkId", () => {
    it("should find next chunk", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_CHUNK);

      const result = await repository.findSubsequentChunkId({ chunkId: TEST_IDS.chunkId });

      expect(mockQuery.queryParams.chunkId).toBe(TEST_IDS.chunkId);
      expect(mockQuery.query).toContain("(current:Chunk {id: $chunkId})-[:NEXT]->(chunk:Chunk)");
      expect(result).toEqual(MOCK_CHUNK);
    });

    it("should return null when no next chunk exists", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findSubsequentChunkId({ chunkId: TEST_IDS.chunkId });

      expect(result).toBeNull();
    });
  });

  describe("findPreviousChunkId", () => {
    it("should find previous chunk", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_CHUNK);

      const result = await repository.findPreviousChunkId({ chunkId: TEST_IDS.chunkId });

      expect(mockQuery.queryParams.chunkId).toBe(TEST_IDS.chunkId);
      expect(mockQuery.query).toContain("(current:Chunk {id: $chunkId})<-[:NEXT]-(chunk:Chunk)");
      expect(result).toEqual(MOCK_CHUNK);
    });

    it("should return null when no previous chunk exists", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findPreviousChunkId({ chunkId: TEST_IDS.chunkId });

      expect(result).toBeNull();
    });
  });

  describe("findChunkById", () => {
    it("should find chunk by ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_CHUNK);

      const result = await repository.findChunkById({ chunkId: TEST_IDS.chunkId });

      expect(mockQuery.queryParams.chunkId).toBe(TEST_IDS.chunkId);
      expect(mockQuery.query).toContain("(chunk:Chunk {id: $chunkId})");
      expect(result).toEqual(MOCK_CHUNK);
    });

    it("should return null when chunk not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findChunkById({ chunkId: "nonexistent" });

      expect(result).toBeNull();
    });
  });

  describe("findChunks", () => {
    it("should find chunks by node ID and type", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CHUNK]);

      const result = await repository.findChunks({
        id: TEST_IDS.contentId,
        nodeType: "Content",
      });

      expect(mockQuery.queryParams.id).toBe(TEST_IDS.contentId);
      expect(mockQuery.query).toContain("(chunk_type:Content {id: $id})");
      expect(mockQuery.query).toContain("[:HAS_CHUNK]->(chunk:Chunk)");
      expect(mockQuery.query).toContain("ORDER BY chunk.position");
      expect(result).toEqual([MOCK_CHUNK]);
    });

    it("should return empty array when no chunks found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findChunks({
        id: "nonexistent",
        nodeType: "Content",
      });

      expect(result).toEqual([]);
    });
  });

  describe("createChunk", () => {
    it("should create chunk with required fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createChunk({
        id: TEST_IDS.chunkId,
        nodeId: TEST_IDS.contentId,
        nodeType: "Content",
        content: "Test chunk content",
        position: 0,
      });

      expect(embedderService.vectoriseText).toHaveBeenCalledWith({ text: "Test chunk content" });
      expect(mockQuery.queryParams).toMatchObject({
        id: TEST_IDS.chunkId,
        content: "Test chunk content",
        position: 0,
        vector: MOCK_EMBEDDING,
        aiStatus: AiStatus.Pending,
        nodeId: TEST_IDS.contentId,
        nodeType: "Content",
      });
      expect(mockQuery.query).toContain("CREATE (chunk:Chunk");
      expect(mockQuery.query).toContain("MERGE (nodeType)-[:HAS_CHUNK]->(chunk)");
      expect(mockQuery.query).toContain("OPTIONAL MATCH (nodeType)-[:BELONGS_TO]->(company)");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should create chunk with optional imagePath", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createChunk({
        id: TEST_IDS.chunkId,
        nodeId: TEST_IDS.contentId,
        nodeType: "Content",
        content: "Test chunk",
        position: 0,
        imagePath: "/path/to/image.png",
      });

      expect(mockQuery.queryParams.imagePath).toBe("/path/to/image.png");
      expect(mockQuery.query).toContain("imagePath: $imagePath");
    });

    it("should create chunk with previous chunk relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createChunk({
        id: TEST_IDS.chunkId,
        nodeId: TEST_IDS.contentId,
        nodeType: "Content",
        content: "Test chunk",
        position: 1,
        previousChunkId: TEST_IDS.nextChunkId,
      });

      expect(mockQuery.queryParams.previousChunkId).toBe(TEST_IDS.nextChunkId);
      expect(mockQuery.query).toContain("MATCH (previous:Chunk {id: $previousChunkId})");
      expect(mockQuery.query).toContain("MERGE (previous)-[:NEXT]->(chunk)");
    });

    it("should handle embedding errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Embedding service unavailable");
      embedderService.vectoriseText.mockRejectedValue(error);

      await expect(
        repository.createChunk({
          id: TEST_IDS.chunkId,
          nodeId: TEST_IDS.contentId,
          nodeType: "Content",
          content: "Test",
          position: 0,
        }),
      ).rejects.toThrow("Embedding service unavailable");
    });
  });

  describe("updateStatus", () => {
    it("should update chunk AI status", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.updateStatus({
        id: TEST_IDS.chunkId,
        aiStatus: AiStatus.Completed,
      });

      expect(mockQuery.queryParams).toMatchObject({
        id: TEST_IDS.chunkId,
        aiStatus: AiStatus.Completed,
      });
      expect(mockQuery.query).toContain("MATCH (chunk:Chunk {id: $id})");
      expect(mockQuery.query).toContain("SET chunk.aiStatus = $aiStatus");
      expect(mockQuery.query).toContain("chunk.updatedAt = datetime()");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle different AI statuses", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const statuses = [AiStatus.Pending, AiStatus.InProgress, AiStatus.Completed, AiStatus.Error];

      for (const status of statuses) {
        vi.clearAllMocks();
        neo4jService.initQuery.mockReturnValue(createMockQuery());
        neo4jService.writeOne.mockResolvedValue(undefined);

        await repository.updateStatus({ id: TEST_IDS.chunkId, aiStatus: status });

        expect(neo4jService.writeOne).toHaveBeenCalled();
      }
    });
  });

  describe("getChunksInProgress", () => {
    it("should get chunks with pending or in-progress status", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CHUNK]);

      const result = await repository.getChunksInProgress({
        id: TEST_IDS.contentId,
        nodeType: "Content",
      });

      expect(mockQuery.queryParams.id).toBe(TEST_IDS.contentId);
      expect(mockQuery.queryParams.aiStatus).toEqual([AiStatus.InProgress, AiStatus.Pending]);
      expect(mockQuery.query).toContain("(chunk_type:Content {id: $id})");
      expect(mockQuery.query).toContain("WHERE chunk.aiStatus IN $aiStatus");
      expect(result).toEqual([MOCK_CHUNK]);
    });
  });

  describe("createNextRelationship", () => {
    it("should create NEXT relationship between chunks", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createNextRelationship({
        chunkId: TEST_IDS.chunkId,
        nextChunkId: TEST_IDS.nextChunkId,
      });

      expect(mockQuery.queryParams).toMatchObject({
        chunkId: TEST_IDS.chunkId,
        nextChunkId: TEST_IDS.nextChunkId,
      });
      expect(mockQuery.query).toContain("MERGE (chunk)-[:NEXT]->(next)");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("deleteChunks", () => {
    it("should delete chunks by IDs", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const chunkIds = [TEST_IDS.chunkId, TEST_IDS.nextChunkId];
      await repository.deleteChunks({ chunkIds });

      expect(mockQuery.queryParams.chunkIds).toEqual(chunkIds);
      expect(mockQuery.query).toContain("WHERE chunk.id IN $chunkIds");
      expect(mockQuery.query).toContain("DETACH DELETE chunk");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle empty array", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteChunks({ chunkIds: [] });

      expect(mockQuery.queryParams.chunkIds).toEqual([]);
      expect(neo4jService.writeOne).toHaveBeenCalled();
    });
  });

  describe("deleteDisconnectedChunks", () => {
    it("should delete orphan chunks", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteDisconnectedChunks();

      expect(mockQuery.query).toContain("MATCH (chunk:Chunk)");
      expect(mockQuery.query).toContain("WHERE NOT (chunk)<-[:HAS_CHUNK]-()");
      expect(mockQuery.query).toContain("DETACH DELETE chunk");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("deleteChunksByNodeType", () => {
    it("should delete chunks by node type and ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.deleteChunksByNodeType({
        id: TEST_IDS.contentId,
        nodeType: "Content",
      });

      expect(mockQuery.queryParams.id).toBe(TEST_IDS.contentId);
      expect(mockQuery.query).toContain("(nodeType:Content {id: $id})");
      expect(mockQuery.query).toContain("[:HAS_CHUNK]->(chunk:Chunk)");
      expect(mockQuery.query).toContain("DETACH DELETE chunk");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("findChunkByContentIdAndType", () => {
    it("should find chunks by content ID and type", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CHUNK]);

      const result = await repository.findChunkByContentIdAndType({
        id: TEST_IDS.contentId,
        type: "Content",
      });

      expect(mockQuery.queryParams).toMatchObject({
        id: TEST_IDS.contentId,
        nodeType: "Content",
      });
      expect(mockQuery.query).toContain("(node:Content {id: $id})");
      expect(mockQuery.query).toContain("[:HAS_CHUNK]->(chunk:Chunk)");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_CHUNK]);
    });

    it("should use fetchAll option", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findChunkByContentIdAndType({
        id: TEST_IDS.contentId,
        type: "Glossary",
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          fetchAll: true,
        }),
      );
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_CHUNK);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.findChunkById({ chunkId: exactId });

      expect(mockQuery.queryParams.chunkId).toBe(exactId);
    });

    it("should handle very long content", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const longContent = "a".repeat(10000);
      await repository.createChunk({
        id: TEST_IDS.chunkId,
        nodeId: TEST_IDS.contentId,
        nodeType: "Content",
        content: longContent,
        position: 0,
      });

      expect(mockQuery.queryParams.content).toBe(longContent);
    });

    it("should handle special characters in content", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const specialContent = "Content with 'quotes' and \"double quotes\" & special <chars>";
      await repository.createChunk({
        id: TEST_IDS.chunkId,
        nodeId: TEST_IDS.contentId,
        nodeType: "Content",
        content: specialContent,
        position: 0,
      });

      expect(mockQuery.queryParams.content).toBe(specialContent);
    });
  });

  describe("Service Integration", () => {
    it("should use ClsService to get userId", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      // An empty scope id-set short-circuits before the vector/lexical reads.
      neo4jService.read.mockResolvedValue({ records: [{ get: () => [] }] });

      await repository.findPotentialChunks({
        question: "test",
        dataLimits: {},
      });

      expect(clsService.get).toHaveBeenCalledWith("userId");
    });

    it("should use EmbedderService for vectorization", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createChunk({
        id: TEST_IDS.chunkId,
        nodeId: TEST_IDS.contentId,
        nodeType: "Content",
        content: "Test content",
        position: 0,
      });

      expect(embedderService.vectoriseText).toHaveBeenCalledWith({ text: "Test content" });
    });
  });
});
