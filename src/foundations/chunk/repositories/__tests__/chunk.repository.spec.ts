import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { ChunkRepository } from "../chunk.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { AI_SOURCE_QUERY } from "../../../../common/repositories/ai-source-query.provider";
import { modelRegistry } from "../../../../common/registries/registry";
import { ModelService } from "../../../../core/llm/services/model.service";
import { EmbedderService } from "../../../../core/llm/services/embedder.service";
import { EntityFactory } from "../../../../core/neo4j/factories/entity.factory";
import { TokenResolverService } from "../../../../core/neo4j/services/token-resolver.service";
import { Chunk, ChunkDescriptor } from "../../entities/chunk.entity";
import { AiStatus } from "../../../../common/enums/ai.status";
import { AgentScopeFilterService } from "../../../../common/repositories/agent-scope.filter";
import { CHUNK_VECTOR_OVERFETCH, EXACT_SCAN_MAX_SCOPED_CHUNKS } from "../retrieval.constants";

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
  // One vector per input text, tagged with the text so slice ordering is assertable.
  vectoriseTextBatch: vi.fn(async (texts: string[]) => texts.map((text) => [`vector:${text}`])),
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

// A driver row of the `id` / `score` shape the cosine read returns.
const scoreRecord = (id: string, score: number) => ({
  get: (key: string) => (key === "id" ? id : key === "score" ? score : undefined),
});

const createMockAgentScopeFilter = () => ({
  current: vi.fn(() => undefined as any),
  build: vi.fn(() => ({ cypher: "", params: {}, applied: false })),
  predicate: vi.fn(() => null as any),
});

describe("ChunkRepository", () => {
  let repository: ChunkRepository;
  let agentScopeFilter: ReturnType<typeof createMockAgentScopeFilter>;
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
    agentScopeFilter = createMockAgentScopeFilter();
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
        { provide: AgentScopeFilterService, useValue: agentScopeFilter },
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

    // Sane defaults so tests that don't explicitly wire every read/write still
    // exercise the method under test without crashing on `undefined.records`.
    // Individual tests override these with mockReturnValue/mockResolvedValueOnce.
    neo4jService.initQuery.mockImplementation(() => createMockQuery());
    neo4jService.read.mockResolvedValue({ records: [] });
    neo4jService.readMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // buildChunkRepositoryUnderTest: the spec file already builds a fresh
  // repository + mocks per test via beforeEach; this just exposes them under
  // the names the plan's test snippets use.
  const buildChunkRepositoryUnderTest = () => ({
    repository,
    neo4j: neo4jService,
    embedder: embedderService,
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

  // Hybrid retrieval (Task 1, reshaped by Task A into scope-first retrieval):
  // a cheap COUNT decides exact-scan vs index-overfetch for the vector branch,
  // a lexical (fulltext) branch runs the same scope-first shape, fused with RRF.
  describe("findPotentialChunks (hybrid retrieval)", () => {
    const makeRecord = (key: string, value: unknown) => ({
      get: (k: string) => (k === key ? value : undefined),
    });

    const chunkC1: Chunk = { ...MOCK_CHUNK, id: "c1" };
    const chunkC2: Chunk = { ...MOCK_CHUNK, id: "c2" };
    const chunkC3: Chunk = { ...MOCK_CHUNK, id: "c3" };

    // Below EXACT_SCAN_MAX_SCOPED_CHUNKS -> exact-scan branch (the common case).
    const SCOPE_COUNT_SMALL = 3;
    // Above EXACT_SCAN_MAX_SCOPED_CHUNKS -> index-overfetch fallback branch.
    const SCOPE_COUNT_LARGE = EXACT_SCAN_MAX_SCOPED_CHUNKS + 1000;

    // Wire the three reads (scoped count, vector branch, lexical branch) plus the
    // final ordered hydration via readMany.
    const wireHybridReads = (scopedCount: number = SCOPE_COUNT_SMALL) => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.read
        .mockResolvedValueOnce({ records: [makeRecord("scopedCount", scopedCount)] })
        .mockResolvedValueOnce({ records: [makeRecord("id", "c1"), makeRecord("id", "c2")] })
        .mockResolvedValueOnce({ records: [makeRecord("id", "c2"), makeRecord("id", "c3")] });
      neo4jService.readMany.mockResolvedValue([chunkC1, chunkC2, chunkC3]);
    };

    it("derives the access-scoped chunk count from the AI_SOURCE_QUERY provider", async () => {
      wireHybridReads();

      await repository.findPotentialChunks({ question: "test question", dataLimits: {} });

      expect(embedderService.vectoriseText).toHaveBeenCalledWith({ text: "test question" });
      expect(aiSourceQueryBuild).toHaveBeenCalledWith(expect.objectContaining({ returnsData: true }));

      const countReadQuery = neo4jService.read.mock.calls[0][0] as string;
      expect(countReadQuery).toContain("MATCH (data)-[:BELONGS_TO]->(company) WITH data");
      expect(countReadQuery).toContain("MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(data)");
      expect(countReadQuery).toContain("count(DISTINCT chunk) AS scopedCount");
    });

    it("runs the exact-scan vector branch (cosine over the scoped set) when the scope is small", async () => {
      wireHybridReads(SCOPE_COUNT_SMALL);

      await repository.findPotentialChunks({ question: "test question", dataLimits: {} });

      const [vectorQuery, vectorParams] = neo4jService.read.mock.calls[1] as [string, Record<string, unknown>];
      expect(vectorQuery).toContain("vector.similarity.cosine(chunk.embedding, $queryEmbedding)");
      expect(vectorQuery).not.toContain("db.index.vector.queryNodes");
      expect(vectorParams.queryEmbedding).toEqual(MOCK_EMBEDDING);
    });

    it("falls back to the vector index with an overfetch when the scoped set is large", async () => {
      wireHybridReads(SCOPE_COUNT_LARGE);

      await repository.findPotentialChunks({ question: "test question", dataLimits: {} });

      const [vectorQuery, vectorParams] = neo4jService.read.mock.calls[1] as [string, Record<string, unknown>];
      expect(vectorQuery).toContain("db.index.vector.queryNodes('chunks'");
      expect(vectorParams.queryEmbedding).toEqual(MOCK_EMBEDDING);
      expect(vectorParams.overFetch).toBe(CHUNK_VECTOR_OVERFETCH);
    });

    it("runs the lexical branch with a Lucene-escaped fulltext term scoped to the id-set", async () => {
      wireHybridReads();

      await repository.findPotentialChunks({ question: "contract (terms)?", dataLimits: {} });

      const [lexicalQuery, lexicalParams] = neo4jService.read.mock.calls[2] as [string, Record<string, unknown>];
      expect(lexicalQuery).toContain("db.index.fulltext.queryNodes('chunk_content_search'");
      // Reserved characters are ESCAPED, not tokenised. `buildFulltextTerm`
      // AND-joins a wildcard per token, which is correct for a search box and
      // fatal for a natural-language question: every token becomes a required
      // clause, so a 28-word question matches nothing at all.
      expect(lexicalParams.term).toBe("contract \\(terms\\)\\?");
    });

    it("does NOT AND-join the question into per-token wildcards", async () => {
      wireHybridReads();

      // Regression guard. Measured against the eval corpus, the AND-joined form
      // of this question returned 0 fulltext hits where the escaped form
      // returned 1,786 — hybrid retrieval silently lost its lexical half.
      await repository.findPotentialChunks({
        question: "Quale termine di adempimento prevede il contratto di locazione",
        dataLimits: {},
      });

      const [, lexicalParams] = neo4jService.read.mock.calls[2] as [string, Record<string, unknown>];
      expect(String(lexicalParams.term)).not.toContain(" AND ");
      expect(String(lexicalParams.term)).not.toContain("*");
    });

    it("fuses the vector + lexical rankings (RRF) and returns chunks in fused order", async () => {
      wireHybridReads();

      const result = await repository.findPotentialChunks({ question: "test question", dataLimits: {} });

      // vector=[c1,c2], lexical=[c2,c3] => RRF rewards the shared c2 first, then c1, then c3.
      expect(result.map((chunk) => chunk.id)).toEqual(["c2", "c1", "c3"]);
      // count + vector + lexical, then the cosine-score read the hydration attaches
      // in JS: `readMany` maps rows through the descriptor's generated mapper, which
      // only reads the descriptor's own fields, so a projected `score` column never
      // reaches the entity and has to be fetched separately.
      expect(neo4jService.read).toHaveBeenCalledTimes(4);
      expect(neo4jService.readMany).toHaveBeenCalledTimes(1);
    });

    // Both retrieval halves must reach the notebook on ONE scale: the answer node
    // orders entries best-score-first and fills a character budget, so a document-half
    // chunk with no score sorts last regardless of how good it is. Cosine (not the
    // rank-derived RRF score) is that scale.
    it("returns chunks carrying a cosine score against the question embedding", async () => {
      wireHybridReads();
      neo4jService.read.mockResolvedValueOnce({
        records: [scoreRecord("c1", 0.61), scoreRecord("c2", 0.83), scoreRecord("c3", 0.42)],
      });

      const result = await repository.findPotentialChunks({ question: "test question", dataLimits: {} });

      expect(result.map((chunk) => chunk.id)).toEqual(["c2", "c1", "c3"]);
      expect(result.map((chunk) => chunk.score)).toEqual([0.83, 0.61, 0.42]);

      const [scoreQuery, scoreParams] = neo4jService.read.mock.calls[3] as [string, Record<string, unknown>];
      expect(scoreQuery).toMatch(/vector\.similarity\.cosine/);
      expect(scoreParams.queryEmbedding).toEqual(MOCK_EMBEDDING);
    });

    // Task 3a-A was deliberately NOT implemented: measurement showed the spec's bar
    // admits every candidate on this corpus, and the owner's decision is that the
    // notebook's character budget — not a floor or a count cap — decides what reaches
    // the answer. A floor reintroduced here would silently drop candidates.
    it("applies no cosine floor to the exact-scan branch", async () => {
      wireHybridReads();

      await repository.findPotentialChunks({ question: "test question", dataLimits: {} });

      const exactScanQuery = String(neo4jService.read.mock.calls[1][0]);
      expect(exactScanQuery).toContain("vector.similarity.cosine(chunk.embedding, $queryEmbedding)");
      expect(exactScanQuery).not.toContain("$relativeFloor");
      expect(exactScanQuery).not.toContain("$absoluteFloor");
    });

    it("returns an empty array when the scope yields no chunks (no vector/lexical reads)", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.read.mockResolvedValueOnce({ records: [makeRecord("scopedCount", 0)] });

      const result = await repository.findPotentialChunks({ question: "nothing", dataLimits: {} });

      expect(result).toEqual([]);
      expect(neo4jService.read).toHaveBeenCalledTimes(1);
      expect(neo4jService.readMany).not.toHaveBeenCalled();
    });

    it("does not embed the question when a queryEmbedding is supplied", async () => {
      wireHybridReads();

      await repository.findPotentialChunks({
        question: "test question",
        dataLimits: {},
        queryEmbedding: [0.9, 0.8, 0.7],
      });

      expect(embedderService.vectoriseText).not.toHaveBeenCalled();
      const [, vectorParams] = neo4jService.read.mock.calls[1] as [string, Record<string, unknown>];
      expect(vectorParams.queryEmbedding).toEqual([0.9, 0.8, 0.7]);
    });

    it("propagates embedding errors", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      embedderService.vectoriseText.mockRejectedValue(new Error("Embedding failed"));

      await expect(repository.findPotentialChunks({ question: "test", dataLimits: {} })).rejects.toThrow(
        "Embedding failed",
      );
    });
  });

  // Task A (Phase 2): the scope gate runs first (a COUNT), so no query ever
  // materialises the full in-scope chunk id-set into the Node heap / a query
  // parameter — that materialisation plus a single global vector-index top-1000
  // is the cross-tenant recall cliff this task removes.
  describe("findPotentialChunks — scope-first retrieval", () => {
    it("issues no query that materialises the full in-scope id set", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      await repository.findPotentialChunks({ question: "q", dataLimits: {} });

      const cyphers = neo4j.read.mock.calls.map((call: any[]) => String(call[0]));
      for (const cypher of cyphers) {
        expect(cypher).not.toMatch(/COLLECT\(DISTINCT\s+chunk\.id\)/i);
      }
    });

    it("does not embed the question when one is supplied", async () => {
      const { repository, embedder } = buildChunkRepositoryUnderTest();
      await repository.findPotentialChunks({
        question: "q",
        dataLimits: {},
        queryEmbedding: [0.1, 0.2, 0.3],
      });
      expect(embedder.vectoriseText).not.toHaveBeenCalled();
    });

    it("embeds the question when none is supplied", async () => {
      const { repository, embedder } = buildChunkRepositoryUnderTest();
      await repository.findPotentialChunks({ question: "q", dataLimits: {} });
      expect(embedder.vectoriseText).toHaveBeenCalledTimes(1);
    });
  });

  describe("findChunkNeighbors — bounded walk", () => {
    it("bounds the NEXT traversal to the requested window", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      await repository.findChunkNeighbors({ chunkIds: ["c1"], window: 1 });

      const cypher = String(neo4j.read.mock.calls.at(-1)![0]);
      expect(cypher).not.toMatch(/\[:NEXT\*1\.\.\]/);
      expect(cypher).toMatch(/\[:NEXT\*1\.\.\d+\]/);
    });

    it("clamps an out-of-range window into [1, 5]", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      await repository.findChunkNeighbors({ chunkIds: ["c1"], window: 999 });

      const cypher = String(neo4j.read.mock.calls.at(-1)![0]);
      expect(cypher).toContain("[:NEXT*1..5]");
    });

    it("no longer passes window as a query parameter", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      await repository.findChunkNeighbors({ chunkIds: ["c1"], window: 2 });

      const [, params] = neo4j.read.mock.calls.at(-1)! as [string, Record<string, unknown>];
      expect(params.window).toBeUndefined();
    });
  });

  describe("findChunksByIds", () => {
    it("hydrates every id in ONE query", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      neo4j.read.mockClear();
      await repository.findChunksByIds({ chunkIds: ["c1", "c2", "c3"], dataLimits: {} });
      expect(neo4j.readMany).toHaveBeenCalledTimes(1);
    });

    it("returns an empty array without querying when given no ids", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      neo4j.readMany.mockClear();
      await expect(repository.findChunksByIds({ chunkIds: [] })).resolves.toEqual([]);
      expect(neo4j.readMany).not.toHaveBeenCalled();
    });

    it("mirrors findChunkById's scope gate exactly (same EXISTS shape)", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      agentScopeFilter.predicate.mockReturnValue({
        cypher: "(data:Child)",
        params: { agentScopeId: "root-1" },
      } as any);
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);

      await repository.findChunksByIds({ chunkIds: ["c1"], dataLimits: {} });

      expect(mockQuery.query).toContain("EXISTS { MATCH (chunk)<-[:HAS_CHUNK]-(data) WHERE (data:Child) }");
      expect((mockQuery.queryParams as any).agentScopeId).toBe("root-1");
    });

    it("does not gate when the run is unscoped", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);

      await repository.findChunksByIds({ chunkIds: ["c1"] });

      expect(mockQuery.query).not.toContain("EXISTS");
    });

    // The loop this method replaced hydrated in queue order. That order reaches the
    // contextualiser's per-chunk fan-out and the notebook entries it writes, so a
    // store-ordered result silently changes what the answer node cites.
    it("returns chunks in the caller's id order, not the store's row order", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      neo4j.readMany.mockResolvedValue([
        { id: "c3", content: "three" },
        { id: "c1", content: "one" },
        { id: "c2", content: "two" },
      ]);

      const chunks = await repository.findChunksByIds({ chunkIds: ["c1", "c2", "c3"], dataLimits: {} });

      expect(chunks.map((chunk) => chunk.id)).toEqual(["c1", "c2", "c3"]);
    });

    // The graph half arrives from a fact join with no score of its own. Without one it
    // sorts last in the notebook budget regardless of quality — which is exactly why an
    // LLM had to judge these chunks before. Cosine against the question embedding puts
    // this half on the same scale as the document half.
    it("scores each chunk against the question embedding when one is supplied", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      neo4j.read.mockClear();
      neo4j.readMany.mockResolvedValue([
        { id: "c1", content: "one" },
        { id: "c2", content: "two" },
      ]);
      neo4j.read.mockResolvedValue({ records: [scoreRecord("c1", 0.55), scoreRecord("c2", 0.31)] });

      const chunks = await repository.findChunksByIds({
        chunkIds: ["c1", "c2"],
        dataLimits: {},
        queryEmbedding: MOCK_EMBEDDING,
      });

      const [scoreQuery, scoreParams] = neo4j.read.mock.calls.at(-1)! as [string, Record<string, unknown>];
      expect(scoreQuery).toMatch(/vector\.similarity\.cosine/);
      expect(scoreParams.queryEmbedding).toEqual(MOCK_EMBEDDING);
      expect(chunks.map((chunk) => chunk.score)).toEqual([0.55, 0.31]);
    });

    it("emits no scoring clause at all when no embedding is supplied", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      neo4j.read.mockClear();
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4j.readMany.mockResolvedValue([{ id: "c1", content: "one" }]);

      const chunks = await repository.findChunksByIds({ chunkIds: ["c1"], dataLimits: {} });

      expect(mockQuery.query).not.toMatch(/vector\.similarity\.cosine/);
      for (const call of neo4j.read.mock.calls) expect(String(call[0])).not.toMatch(/vector\.similarity\.cosine/);
      expect(chunks[0].score).toBeUndefined();
    });

    // Same regression guard as above, with scoring on: attaching a score must not be
    // allowed to re-order the result into store order.
    it("returns scored chunks in the caller's id order, not the store's row order", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      neo4j.read.mockClear();
      neo4j.readMany.mockResolvedValue([
        { id: "c3", content: "three" },
        { id: "c1", content: "one" },
        { id: "c2", content: "two" },
      ]);
      neo4j.read.mockResolvedValue({
        records: [scoreRecord("c2", 0.9), scoreRecord("c3", 0.1), scoreRecord("c1", 0.5)],
      });

      const chunks = await repository.findChunksByIds({
        chunkIds: ["c1", "c2", "c3"],
        dataLimits: {},
        queryEmbedding: MOCK_EMBEDDING,
      });

      expect(chunks.map((chunk) => chunk.id)).toEqual(["c1", "c2", "c3"]);
      expect(chunks.map((chunk) => chunk.score)).toEqual([0.5, 0.9, 0.1]);
    });

    it("drops ids the query did not return without disturbing the order of the rest", async () => {
      const { repository, neo4j } = buildChunkRepositoryUnderTest();
      neo4j.readMany.mockResolvedValue([
        { id: "c3", content: "three" },
        { id: "c1", content: "one" },
      ]);

      const chunks = await repository.findChunksByIds({ chunkIds: ["c1", "c2", "c3"], dataLimits: {} });

      expect(chunks.map((chunk) => chunk.id)).toEqual(["c1", "c3"]);
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
      expect(mockQuery.query).toContain("MATCH (:Content {id: $id})");
      expect(mockQuery.query).toContain("[:HAS_CHUNK]->(chunkNode:Chunk)");
      expect(mockQuery.query).toContain("ORDER BY chunkNode.position");
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

    // Heap guard: a :Chunk node carries a full embedding vector and NO consumer of
    // findChunks reads it, so the projection must not return it.
    it("projects chunk properties WITHOUT the embedding (and drops the dead chunk_type binding)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findChunks({ id: TEST_IDS.contentId, nodeType: "Content" });

      expect(mockQuery.query).not.toContain("embedding");
      expect(mockQuery.query).not.toContain("chunk_type");
      // Aliased back to the descriptor's nodeName so EntityFactory still finds the column.
      expect(mockQuery.query).toContain("} AS chunk");
      expect(mockQuery.query).toContain("labels: labels(chunkNode)");
      expect(mockQuery.query).toContain("properties: chunkNode {");
    });
  });

  // C2 mapper-compat proof: findChunks returns a hand-built `{ labels, properties }` map
  // rather than a Node. EntityFactory keys "is this a node?" off the `labels` field and
  // maps `properties`, so the projected shape must hydrate exactly like a real node did.
  describe("findChunks projection — descriptor mapper compatibility", () => {
    const makeRecord = (cols: Record<string, unknown>): any => ({
      keys: Object.keys(cols),
      has: (key: string) => key in cols,
      get: (key: string) => cols[key],
    });

    // Mirrors the RETURN of findChunks: labels + the descriptor's own properties, no embedding.
    const projectedChunkRow = {
      labels: ["Chunk"],
      properties: {
        id: TEST_IDS.chunkId,
        content: "Test chunk content",
        heading: "Articolo 3",
        position: 2,
        aiStatus: AiStatus.Completed,
        nodeId: TEST_IDS.contentId,
        nodeType: "Content",
        imagePath: null,
        dates: JSON.stringify([{ date: "2024-03-01", description: "udienza" }]),
        propagatedDates: null,
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-02T00:00:00Z",
      },
    };

    it("hydrates content/heading/position/dates and leaves embedding undefined", () => {
      const factory = new EntityFactory(new TokenResolverService());

      const [chunk] = factory.createGraphList({
        model: ChunkDescriptor.model,
        records: [makeRecord({ chunk: projectedChunkRow })],
      });

      expect(chunk.id).toBe(TEST_IDS.chunkId);
      expect(chunk.type).toBe("chunk");
      expect(chunk.content).toBe("Test chunk content");
      expect(chunk.heading).toBe("Articolo 3");
      expect(chunk.position).toBe(2);
      expect(chunk.dates).toEqual([{ date: "2024-03-01", description: "udienza" }]);
      expect(chunk.createdAt).toEqual(new Date("2025-01-01T00:00:00Z"));

      // The whole point of the projection.
      expect(chunk.embedding).toBeUndefined();
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

      expect(embedderService.vectoriseText).toHaveBeenCalledWith({
        text: "Test chunk content",
        attribution: { relationshipId: TEST_IDS.contentId, relationshipType: "Content" },
      });
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

    // Cost attribution: the upload path must bill the embedding to the chunk's parent
    // node, so EmbedderService writes a TokenUsage record against it.
    it("attributes the embedding to the parent node (nodeId/nodeType)", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createChunk({
        id: TEST_IDS.chunkId,
        nodeId: "doc-1",
        nodeType: "Document",
        content: "Test chunk content",
        position: 0,
      });

      expect(embedderService.vectoriseText).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: { relationshipId: "doc-1", relationshipType: "Document" },
        }),
      );
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

  // Pipeline guards only ever asked "is anything still pending?" — hydrating every
  // chunk (embeddings included) to answer that is what made the guard quadratic.
  describe("countChunksInProgress", () => {
    const makeCountResult = (value: unknown) => ({
      records: [{ get: (key: string) => (key === "count" ? value : undefined) }],
    });

    it("issues a count() query filtered to pending/in-progress chunks", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue(makeCountResult(7));

      const result = await repository.countChunksInProgress({
        id: TEST_IDS.contentId,
        nodeType: "Content",
      });

      expect(mockQuery.queryParams.id).toBe(TEST_IDS.contentId);
      expect(mockQuery.queryParams.aiStatus).toEqual([AiStatus.InProgress, AiStatus.Pending]);

      const [cypher] = neo4jService.read.mock.calls[0] as [string, Record<string, unknown>];
      expect(cypher).toContain("MATCH (:Content {id: $id})");
      expect(cypher).toContain("[:HAS_CHUNK]->(chunk:Chunk)");
      expect(cypher).toContain("WHERE chunk.aiStatus IN $aiStatus");
      expect(cypher).toContain("count(chunk) AS count");
      // Never hydrates entities — that is the whole point.
      expect(neo4jService.readMany).not.toHaveBeenCalled();

      expect(result).toBe(7);
    });

    it("unwraps a neo4j-driver Integer count", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.read.mockResolvedValue(makeCountResult({ low: 12, high: 0, toNumber: () => 12 }));

      const result = await repository.countChunksInProgress({
        id: TEST_IDS.contentId,
        nodeType: "Content",
      });

      expect(result).toBe(12);
    });

    it("returns 0 when the query yields no rows", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.read.mockResolvedValue({ records: [] });

      const result = await repository.countChunksInProgress({
        id: TEST_IDS.contentId,
        nodeType: "Content",
      });

      expect(result).toBe(0);
    });
  });

  // Heap guard: a whole document's vectors held at once is what pushed the worker
  // past its heap, so the batch is embedded and written in fixed slices.
  describe("enrichContentAndEmbedBatch", () => {
    const makeItems = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        chunkId: `chunk-${index}`,
        enrichedContent: `content-${index}`,
      }));

    it("does nothing when there are no items", async () => {
      await repository.enrichContentAndEmbedBatch([]);

      expect(embedderService.vectoriseTextBatch).not.toHaveBeenCalled();
      expect(neo4jService.writeOne).not.toHaveBeenCalled();
    });

    it("embeds and writes in slices of 50, preserving input order", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.writeOne.mockResolvedValue(undefined);
      const items = makeItems(130);

      await repository.enrichContentAndEmbedBatch(items, {
        relationshipId: "doc-1",
        relationshipType: "Document",
      });

      // 50 / 50 / 30
      expect(embedderService.vectoriseTextBatch).toHaveBeenCalledTimes(3);
      expect(embedderService.vectoriseTextBatch.mock.calls.map((call: any[]) => call[0].length)).toEqual([50, 50, 30]);
      expect(neo4jService.writeOne).toHaveBeenCalledTimes(3);

      const writtenRows = neo4jService.writeOne.mock.calls.flatMap(
        (call: any[]) => call[0].queryParams.rows as { chunkId: string; vector: unknown; propagatedDates: unknown }[],
      );
      expect(writtenRows).toHaveLength(130);
      expect(writtenRows.map((row) => row.chunkId)).toEqual(items.map((item) => item.chunkId));
      // Each row keeps the vector produced for its own text (no cross-slice offset bug).
      expect(writtenRows[0].vector).toEqual(["vector:content-0"]);
      expect(writtenRows[49].vector).toEqual(["vector:content-49"]);
      expect(writtenRows[50].vector).toEqual(["vector:content-50"]);
      expect(writtenRows[129].vector).toEqual(["vector:content-129"]);
      expect(writtenRows[0].propagatedDates).toBeNull();
    });

    it("forwards the attribution on every slice (one usage record per slice)", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.enrichContentAndEmbedBatch(makeItems(130), {
        relationshipId: "doc-1",
        relationshipType: "Document",
      });

      for (const call of embedderService.vectoriseTextBatch.mock.calls as any[][]) {
        expect(call[1]).toEqual({ relationshipId: "doc-1", relationshipType: "Document" });
      }
    });

    it("writes propagated dates when present", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.enrichContentAndEmbedBatch([
        { chunkId: "chunk-a", enrichedContent: "content-a", propagatedDates: '[{"date":"2024-03-01"}]' },
      ]);

      const [query] = neo4jService.writeOne.mock.calls[0] as any[];
      expect(query.queryParams.rows).toEqual([
        {
          chunkId: "chunk-a",
          enrichedContent: "content-a",
          vector: ["vector:content-a"],
          propagatedDates: '[{"date":"2024-03-01"}]',
        },
      ]);
      expect(query.query).toContain("SET chunk.content = row.enrichedContent");
      expect(query.query).toContain("chunk.embedding = row.vector");
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

      expect(embedderService.vectoriseText).toHaveBeenCalledWith({
        text: "Test content",
        attribution: { relationshipId: TEST_IDS.contentId, relationshipType: "Content" },
      });
    });
  });

  // Embedding cost attribution (Task 8). `relationshipType` MUST be the Neo4j
  // LABEL — a TokenUsage record's USED_FOR edge is matched on the label, so a
  // JSON:API type passed verbatim writes a record that is billed against nothing.
  describe("embedding cost attribution", () => {
    beforeEach(() => {
      modelRegistry.register({ nodeName: "npc", labelName: "Npc", type: "npcs" } as never);
    });

    it("attributes a chunk embedding to the chunk's owning entity", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createChunk({
        id: TEST_IDS.chunkId,
        nodeId: "npc-1",
        nodeType: "Npc",
        content: "x",
        position: 0,
      });

      expect(embedderService.vectoriseText).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: expect.objectContaining({ relationshipId: "npc-1", relationshipType: "Npc" }),
        }),
      );
    });

    it("translates a JSON:API nodeType into its Neo4j label", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createChunk({
        id: TEST_IDS.chunkId,
        nodeId: "npc-1",
        nodeType: "npcs",
        content: "x",
        position: 0,
      });

      expect(embedderService.vectoriseText).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: expect.objectContaining({ relationshipId: "npc-1", relationshipType: "Npc" }),
        }),
      );
    });

    it("forwards the caller's attribution on a query-time embedding", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.findPotentialChunks({
        question: "test question",
        dataLimits: {},
        attribution: { relationshipId: "campaign-1", relationshipType: "Campaign" },
      });

      expect(embedderService.vectoriseText).toHaveBeenCalledWith({
        text: "test question",
        attribution: { relationshipId: "campaign-1", relationshipType: "Campaign" },
      });
    });

    it("records NOTHING for an empty batch — zero tokens must write no row", async () => {
      await repository.enrichContentAndEmbedBatch([], { relationshipId: "npc-1", relationshipType: "Npc" });

      expect(embedderService.vectoriseTextBatch).not.toHaveBeenCalled();
      expect(neo4jService.writeOne).not.toHaveBeenCalled();
    });

    it("records ONE attributed batch for the parent entity's chunks", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.enrichContentAndEmbedBatch(
        [
          { chunkId: "c1", enrichedContent: "a" },
          { chunkId: "c2", enrichedContent: "b" },
        ],
        { relationshipId: "npc-1", relationshipType: "Npc" },
      );

      expect(embedderService.vectoriseTextBatch).toHaveBeenCalledTimes(1);
      expect(embedderService.vectoriseTextBatch).toHaveBeenCalledWith(["a", "b"], {
        relationshipId: "npc-1",
        relationshipType: "Npc",
      });
    });
  });

  // Both the vector and the lexical branch of hybrid retrieval are filtered to
  // the id-set built by the scope query, so confining that query confines the
  // whole search.
  describe("scope isolation", () => {
    const makeRecord = (key: string, value: unknown) => ({
      get: (k: string) => (k === key ? value : undefined),
    });

    it("confines the hybrid id-set to the run's scope root", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.read
        .mockResolvedValueOnce({ records: [makeRecord("chunkIds", ["c1"])] })
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({ records: [] });
      neo4jService.readMany.mockResolvedValue([]);
      agentScopeFilter.build.mockReturnValue({
        cypher: "WHERE (data:Child)",
        params: { agentScopeId: "root-1" },
        applied: true,
      } as any);

      await repository.findPotentialChunks({ question: "q", dataLimits: {} });

      expect(agentScopeFilter.build).toHaveBeenCalledWith({ alias: "data", dataLimits: {} });
      const scopeQuery = neo4jService.read.mock.calls[0][0] as string;
      expect(scopeQuery).toContain("WHERE (data:Child)");
      expect((neo4jService.read.mock.calls[0][1] as any).agentScopeId).toBe("root-1");
    });

    // The ids reaching findChunkById come from an LLM choosing among the chunks
    // it was shown — a soft constraint, so the root is re-checked here.
    it("re-checks the scope root on a chunk fetched by id", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_CHUNK);
      agentScopeFilter.predicate.mockReturnValue({
        cypher: "(data:Child)",
        params: { agentScopeId: "root-1" },
      } as any);

      await repository.findChunkById({ chunkId: "c1", dataLimits: {} });

      expect(mockQuery.query).toContain("EXISTS { MATCH (chunk)<-[:HAS_CHUNK]-(data) WHERE (data:Child) }");
      expect((mockQuery.queryParams as any).agentScopeId).toBe("root-1");
    });

    it("does not gate a by-id fetch in an unscoped run", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_CHUNK);

      await repository.findChunkById({ chunkId: "c1" });

      expect(mockQuery.query).not.toContain("EXISTS");
      expect(mockQuery.query).toContain("MATCH (chunk:Chunk {id: $chunkId})");
    });
  });
});
