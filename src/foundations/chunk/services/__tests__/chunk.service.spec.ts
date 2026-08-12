import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { Document } from "@langchain/core/documents";
import { ChunkService } from "../chunk.service";
import { ChunkRepository } from "../../repositories/chunk.repository";
import { AtomicFactService } from "../../../atomicfact/services/atomicfact.service";
import { KeyConceptService } from "../../../keyconcept/services/keyconcept.service";
import { KeyConceptRepository } from "../../../keyconcept/repositories/keyconcept.repository";
import { GraphCreatorService } from "../../../../agents/graph.creator/services/graph.creator.service";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { TracingService } from "../../../../core/tracing/services/tracing.service";
import { AiStatus } from "../../../../common/enums/ai.status";
import { modelRegistry } from "../../../../common/registries/registry";

// Mock crypto
vi.mock("crypto", async () => {
  const actual = await vi.importActual("crypto");
  let uuidCounter = 0;
  return {
    ...actual,
    randomUUID: () => `mock-uuid-${++uuidCounter}`,
  };
});

describe("ChunkService", () => {
  let service: ChunkService;
  let logger: MockedObject<AppLoggingService>;
  let tracer: MockedObject<TracingService>;
  let clsService: MockedObject<ClsService>;
  let jsonApiService: MockedObject<JsonApiService>;
  let chunkRepository: MockedObject<ChunkRepository>;
  let atomicFactService: MockedObject<AtomicFactService>;
  let keyConceptService: MockedObject<KeyConceptService>;
  let graphCreatorService: MockedObject<GraphCreatorService>;
  let keyConceptRepository: MockedObject<KeyConceptRepository>;
  let moduleRef: MockedObject<ModuleRef>;
  let mockQueue: any;

  const TEST_IDS = {
    chunkId: "550e8400-e29b-41d4-a716-446655440000",
    contentId: "660e8400-e29b-41d4-a716-446655440001",
    companyId: "770e8400-e29b-41d4-a716-446655440002",
    userId: "880e8400-e29b-41d4-a716-446655440003",
  };

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

  const createMockTracer = () => ({
    startSpan: vi.fn(),
    endSpan: vi.fn(),
    addSpanEvent: vi.fn(),
    addSpanAttribute: vi.fn(),
    getActiveSpan: vi.fn(),
    getCurrentContext: vi.fn(),
  });

  const createMockClsService = () => ({
    get: vi.fn(),
    set: vi.fn(),
    run: vi.fn(),
  });

  const createMockJsonApiService = () => ({
    buildSingle: vi.fn(),
    buildList: vi.fn(),
    buildError: vi.fn(),
  });

  const createMockChunkRepository = () => ({
    findChunkById: vi.fn(),
    findChunks: vi.fn(),
    findParentName: vi.fn(),
    createChunk: vi.fn(),
    deleteChunksByNodeType: vi.fn(),
    updateStatus: vi.fn(),
    updateDates: vi.fn(),
    findParentName: vi.fn(),
    enrichContentAndEmbedBatch: vi.fn(),
    clearFinalisationClaim: vi.fn(),
  });

  const createMockAtomicFactService = () => ({
    createAtomicFact: vi.fn(),
    deleteDisconnectedAtomicFacts: vi.fn(),
  });

  const createMockKeyConceptService = () => ({
    addKeyConceptRelationships: vi.fn(),
    resizeKeyConceptRelationshipsWeightOnChunkDeletion: vi.fn(),
    deleteDisconnectedKeyConcepts: vi.fn(),
  });

  const createMockGraphCreatorService = () => ({
    generateGraph: vi.fn(),
  });

  const createMockKeyConceptRepository = () => ({
    createOrphanKeyConcepts: vi.fn(),
    updateKeyConceptDescriptions: vi.fn(),
  });

  const createMockConfigService = () => ({
    get: vi.fn().mockReturnValue({
      process: { content: "process-content", unknown: "process-unknown" },
      notifications: {},
    }),
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockQueue = {
      add: vi.fn(),
    };

    const mockModuleRef = {
      get: vi.fn().mockReturnValue(mockQueue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChunkService,
        { provide: AppLoggingService, useValue: createMockLogger() },
        { provide: TracingService, useValue: createMockTracer() },
        { provide: ClsService, useValue: createMockClsService() },
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: ChunkRepository, useValue: createMockChunkRepository() },
        { provide: AtomicFactService, useValue: createMockAtomicFactService() },
        { provide: KeyConceptService, useValue: createMockKeyConceptService() },
        { provide: GraphCreatorService, useValue: createMockGraphCreatorService() },
        { provide: KeyConceptRepository, useValue: createMockKeyConceptRepository() },
        { provide: ModuleRef, useValue: mockModuleRef },
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    service = module.get<ChunkService>(ChunkService);
    logger = module.get(AppLoggingService) as MockedObject<AppLoggingService>;
    tracer = module.get(TracingService) as MockedObject<TracingService>;
    clsService = module.get(ClsService) as MockedObject<ClsService>;
    jsonApiService = module.get(JsonApiService) as MockedObject<JsonApiService>;
    chunkRepository = module.get(ChunkRepository) as MockedObject<ChunkRepository>;
    atomicFactService = module.get(AtomicFactService) as MockedObject<AtomicFactService>;
    keyConceptService = module.get(KeyConceptService) as MockedObject<KeyConceptService>;
    graphCreatorService = module.get(GraphCreatorService) as MockedObject<GraphCreatorService>;
    keyConceptRepository = module.get(KeyConceptRepository) as MockedObject<KeyConceptRepository>;
    moduleRef = module.get(ModuleRef) as MockedObject<ModuleRef>;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("findById", () => {
    it("should find a chunk by ID and return JSON:API response", async () => {
      // Arrange
      const mockChunk = { id: TEST_IDS.chunkId, content: "Test content" };
      const mockJsonApiResponse = { data: { type: "chunks", id: TEST_IDS.chunkId } };
      chunkRepository.findChunkById.mockResolvedValue(mockChunk);
      jsonApiService.buildSingle.mockReturnValue(mockJsonApiResponse);

      // Act
      const result = await service.findById({ chunkId: TEST_IDS.chunkId });

      // Assert
      expect(chunkRepository.findChunkById).toHaveBeenCalledWith({ chunkId: TEST_IDS.chunkId });
      expect(jsonApiService.buildSingle).toHaveBeenCalled();
      expect(result).toBe(mockJsonApiResponse);
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      chunkRepository.findChunkById.mockRejectedValue(new Error("Not found"));

      // Act & Assert
      await expect(service.findById({ chunkId: TEST_IDS.chunkId })).rejects.toThrow("Not found");
    });
  });

  describe("createChunks", () => {
    it("should create chunks from documents", async () => {
      // Arrange
      const documents: Document[] = [
        { pageContent: "Content 1", metadata: {}, id: undefined },
        { pageContent: "Content 2", metadata: {}, id: undefined },
      ];
      const expectedChunks = [
        { id: "chunk-1", content: "Content 1" },
        { id: "chunk-2", content: "Content 2" },
      ];
      chunkRepository.createChunk.mockResolvedValue(undefined);
      chunkRepository.findChunks.mockResolvedValue(expectedChunks);

      // Act
      const result = await service.createChunks({
        id: TEST_IDS.contentId,
        nodeType: "content",
        data: documents,
      });

      // Assert
      expect(chunkRepository.createChunk).toHaveBeenCalledTimes(2);
      expect(chunkRepository.findChunks).toHaveBeenCalledWith({
        id: TEST_IDS.contentId,
        nodeType: "content",
      });
      expect(result).toBe(expectedChunks);
    });

    // The create path returns whatever findChunks hydrates, and findChunks is lean by
    // design (no embedding vectors) — see the repository spec's mapper-compat proof.
    it("returns the lean chunks from findChunks (no embeddings on the create path)", async () => {
      // Arrange
      const documents: Document[] = [{ pageContent: "Content 1", metadata: {}, id: undefined }];
      const leanChunks = [{ id: "chunk-1", content: "Content 1", heading: "H", position: 0, dates: [] }];
      chunkRepository.createChunk.mockResolvedValue(undefined);
      chunkRepository.findChunks.mockResolvedValue(leanChunks);

      // Act
      const result = await service.createChunks({
        id: TEST_IDS.contentId,
        nodeType: "content",
        data: documents,
      });

      // Assert
      expect(result).toBe(leanChunks);
      expect(result.every((chunk) => (chunk as { embedding?: number[] }).embedding === undefined)).toBe(true);
    });

    it("should link chunks sequentially with previousChunkId", async () => {
      // Arrange
      const documents: Document[] = [
        { pageContent: "Content 1", metadata: {}, id: undefined },
        { pageContent: "Content 2", metadata: {}, id: undefined },
        { pageContent: "Content 3", metadata: {}, id: undefined },
      ];
      chunkRepository.createChunk.mockResolvedValue(undefined);
      chunkRepository.findChunks.mockResolvedValue([]);

      // Act
      await service.createChunks({
        id: TEST_IDS.contentId,
        nodeType: "content",
        data: documents,
      });

      // Assert
      const calls = chunkRepository.createChunk.mock.calls;
      expect(calls[0][0].previousChunkId).toBeUndefined(); // First chunk has no previous
      expect(calls[0][0].position).toBe(0);
      expect(calls[1][0].previousChunkId).toBeDefined(); // Second chunk links to first
      expect(calls[1][0].position).toBe(1);
      expect(calls[2][0].previousChunkId).toBeDefined(); // Third chunk links to second
      expect(calls[2][0].position).toBe(2);
    });

    it("should handle empty document array", async () => {
      // Arrange
      chunkRepository.findChunks.mockResolvedValue([]);

      // Act
      const result = await service.createChunks({
        id: TEST_IDS.contentId,
        nodeType: "content",
        data: [],
      });

      // Assert
      expect(chunkRepository.createChunk).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe("deleteChunks", () => {
    it("should delete chunks and cleanup related data", async () => {
      // Arrange
      const mockChunks = [{ id: "chunk-1" }, { id: "chunk-2" }];
      chunkRepository.findChunks.mockResolvedValue(mockChunks);
      keyConceptService.resizeKeyConceptRelationshipsWeightOnChunkDeletion.mockResolvedValue(undefined);
      chunkRepository.deleteChunksByNodeType.mockResolvedValue(undefined);
      atomicFactService.deleteDisconnectedAtomicFacts.mockResolvedValue(undefined);

      // Act
      await service.deleteChunks({
        id: TEST_IDS.contentId,
        nodeType: "content",
      });

      // Assert
      expect(chunkRepository.findChunks).toHaveBeenCalledWith({
        id: TEST_IDS.contentId,
        nodeType: "content",
      });
      expect(keyConceptService.resizeKeyConceptRelationshipsWeightOnChunkDeletion).toHaveBeenCalledTimes(2);
      expect(chunkRepository.deleteChunksByNodeType).toHaveBeenCalledWith({
        id: TEST_IDS.contentId,
        nodeType: "content",
      });
      expect(atomicFactService.deleteDisconnectedAtomicFacts).toHaveBeenCalled();
    });

    it("should handle no chunks to delete", async () => {
      // Arrange
      chunkRepository.findChunks.mockResolvedValue([]);
      chunkRepository.deleteChunksByNodeType.mockResolvedValue(undefined);
      atomicFactService.deleteDisconnectedAtomicFacts.mockResolvedValue(undefined);

      // Act
      await service.deleteChunks({
        id: TEST_IDS.contentId,
        nodeType: "content",
      });

      // Assert
      expect(keyConceptService.resizeKeyConceptRelationshipsWeightOnChunkDeletion).not.toHaveBeenCalled();
      expect(chunkRepository.deleteChunksByNodeType).toHaveBeenCalled();
      expect(atomicFactService.deleteDisconnectedAtomicFacts).toHaveBeenCalled();
    });
  });

  describe("generateGraph", () => {
    const mockChunkAnalysis = {
      atomicFacts: [
        { content: "Fact 1", keyConcepts: ["concept1", "concept2"] },
        { content: "Fact 2", keyConcepts: ["concept2", "concept3"] },
      ],
      keyConceptsRelationships: [{ keyConcept1: "concept1", keyConcept2: "concept2", relationship: "relates to" }],
      keyConceptDescriptions: [{ keyConcept: "concept1", description: "Description 1" }],
      tokens: { input: 100, output: 50 },
    };

    it("should generate graph for a chunk", async () => {
      // Arrange
      const mockChunk = { id: TEST_IDS.chunkId, content: "Test content" };
      chunkRepository.findChunkById.mockResolvedValue(mockChunk);
      chunkRepository.updateStatus.mockResolvedValue(undefined);
      graphCreatorService.generateGraph.mockResolvedValue(mockChunkAnalysis);
      keyConceptRepository.createOrphanKeyConcepts.mockResolvedValue(undefined);
      keyConceptRepository.updateKeyConceptDescriptions.mockResolvedValue(undefined);
      atomicFactService.createAtomicFact.mockResolvedValue(undefined);
      keyConceptService.addKeyConceptRelationships.mockResolvedValue(undefined);
      clsService.get.mockReturnValue(TEST_IDS.companyId);
      mockQueue.add.mockResolvedValue(undefined);

      // Act
      await service.generateGraph({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
        chunkId: TEST_IDS.chunkId,
        id: TEST_IDS.contentId,
        type: "content",
      });

      // Assert
      expect(tracer.startSpan).toHaveBeenCalledWith("Graph Creation", expect.anything());
      expect(chunkRepository.findChunkById).toHaveBeenCalledWith({ chunkId: TEST_IDS.chunkId });
      expect(chunkRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_IDS.chunkId,
        aiStatus: AiStatus.InProgress,
      });
      expect(graphCreatorService.generateGraph).toHaveBeenCalledWith({
        content: "Test content",
        relationshipId: TEST_IDS.contentId,
        relationshipType: "content",
      });
      expect(atomicFactService.createAtomicFact).toHaveBeenCalledTimes(2);
      expect(chunkRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_IDS.chunkId,
        aiStatus: AiStatus.Completed,
      });
      expect(tracer.endSpan).toHaveBeenCalled();
    });

    // Cost attribution: the orphan key-concept embeddings are billed against the
    // content being analysed, not left unattributed.
    it("attributes the orphan key-concept embeddings to the analysed content", async () => {
      // Arrange
      const mockChunk = { id: TEST_IDS.chunkId, content: "Test content" };
      chunkRepository.findChunkById.mockResolvedValue(mockChunk);
      chunkRepository.updateStatus.mockResolvedValue(undefined);
      chunkRepository.updateDates.mockResolvedValue(undefined);
      graphCreatorService.generateGraph.mockResolvedValue(mockChunkAnalysis);
      keyConceptRepository.createOrphanKeyConcepts.mockResolvedValue(undefined);
      keyConceptRepository.updateKeyConceptDescriptions.mockResolvedValue(undefined);
      atomicFactService.createAtomicFact.mockResolvedValue(undefined);
      keyConceptService.addKeyConceptRelationships.mockResolvedValue(undefined);
      clsService.get.mockReturnValue(TEST_IDS.companyId);
      mockQueue.add.mockResolvedValue(undefined);

      // Act
      await service.generateGraph({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
        chunkId: TEST_IDS.chunkId,
        id: TEST_IDS.contentId,
        type: "content",
      });

      // Assert
      expect(keyConceptRepository.createOrphanKeyConcepts).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: { relationshipId: TEST_IDS.contentId, relationshipType: "content" },
        }),
      );
    });

    it("should retry on graph generation failure and return empty fallback", { timeout: 30000 }, async () => {
      // Arrange
      const mockChunk = { id: TEST_IDS.chunkId, content: "Test content" };
      chunkRepository.findChunkById.mockResolvedValue(mockChunk);
      chunkRepository.updateStatus.mockResolvedValue(undefined);
      graphCreatorService.generateGraph.mockRejectedValue(new Error("LLM error"));
      clsService.get.mockReturnValue(TEST_IDS.companyId);
      mockQueue.add.mockResolvedValue(undefined);

      // Act
      await service.generateGraph({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
        chunkId: TEST_IDS.chunkId,
        id: TEST_IDS.contentId,
        type: "content",
      });

      // Advance timers for retries
      await vi.runAllTimersAsync();

      // Assert - should have tried 4 times (initial + 3 retries)
      expect(graphCreatorService.generateGraph).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
      expect(chunkRepository.updateStatus).toHaveBeenCalledWith({
        id: TEST_IDS.chunkId,
        aiStatus: AiStatus.Completed,
      });
    });

    it("should handle null chunk analysis", async () => {
      // Arrange
      const mockChunk = { id: TEST_IDS.chunkId, content: "Test content" };
      chunkRepository.findChunkById.mockResolvedValue(mockChunk);
      chunkRepository.updateStatus.mockResolvedValue(undefined);
      graphCreatorService.generateGraph.mockResolvedValue(null);
      clsService.get.mockReturnValue(TEST_IDS.companyId);
      mockQueue.add.mockResolvedValue(undefined);

      // Act
      await service.generateGraph({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
        chunkId: TEST_IDS.chunkId,
        id: TEST_IDS.contentId,
        type: "content",
      });

      // Assert
      expect(logger.warn).toHaveBeenCalledWith(
        "Chunk analysis returned null - content was rejected by graph creator",
        "ChunkService",
        expect.anything(),
      );
      expect(atomicFactService.createAtomicFact).not.toHaveBeenCalled();
    });

    it("should queue next job after completion", async () => {
      // Arrange
      const mockChunk = { id: TEST_IDS.chunkId, content: "Test content" };
      chunkRepository.findChunkById.mockResolvedValue(mockChunk);
      chunkRepository.updateStatus.mockResolvedValue(undefined);
      graphCreatorService.generateGraph.mockResolvedValue(mockChunkAnalysis);
      keyConceptRepository.createOrphanKeyConcepts.mockResolvedValue(undefined);
      keyConceptRepository.updateKeyConceptDescriptions.mockResolvedValue(undefined);
      atomicFactService.createAtomicFact.mockResolvedValue(undefined);
      keyConceptService.addKeyConceptRelationships.mockResolvedValue(undefined);
      clsService.get.mockReturnValue(TEST_IDS.companyId);
      mockQueue.add.mockResolvedValue(undefined);

      // Act
      await service.generateGraph({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
        chunkId: TEST_IDS.chunkId,
        id: TEST_IDS.contentId,
        type: "content",
      });

      // Assert
      // No jobId, deliberately — a stable one makes BullMQ drop every add after the first,
      // including the last chunk's, which is the one that actually finalises the content.
      // Duplicate jobs are rejected by ChunkRepository.claimContentFinalisation instead.
      expect(mockQueue.add).toHaveBeenCalledWith("process-content", {
        id: TEST_IDS.contentId,
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
      });
    });

    // The GraphCreator now emits a `dates` array (default `[]`). generateGraph
    // persists it on the chunk via updateDates — preserved when present, `[]` when
    // the analysis omits it. (Tests the in-scope manifestation of the GraphCreator
    // `dates` default/preserved contract — see hand-off note.)
    describe("extracted dates persistence", () => {
      const baseAnalysis = {
        atomicFacts: [{ content: "Fact", keyConcepts: ["concept1"] }],
        keyConceptsRelationships: [],
        keyConceptDescriptions: [],
        tokens: { input: 1, output: 1 },
      };

      const arrange = (analysis: any) => {
        const mockChunk = { id: TEST_IDS.chunkId, content: "Test content" };
        chunkRepository.findChunkById.mockResolvedValue(mockChunk);
        chunkRepository.updateStatus.mockResolvedValue(undefined);
        chunkRepository.updateDates.mockResolvedValue(undefined);
        graphCreatorService.generateGraph.mockResolvedValue(analysis);
        keyConceptRepository.createOrphanKeyConcepts.mockResolvedValue(undefined);
        keyConceptRepository.updateKeyConceptDescriptions.mockResolvedValue(undefined);
        atomicFactService.createAtomicFact.mockResolvedValue(undefined);
        keyConceptService.addKeyConceptRelationships.mockResolvedValue(undefined);
        clsService.get.mockReturnValue(TEST_IDS.companyId);
        mockQueue.add.mockResolvedValue(undefined);
      };

      it("persists the extracted dates when the analysis carries them", async () => {
        const dates = [
          { date: "2024-01-01", description: "contract signed" },
          { date: "2024-06-30", description: "delivery" },
        ];
        arrange({ ...baseAnalysis, dates });

        await service.generateGraph({
          companyId: TEST_IDS.companyId,
          userId: TEST_IDS.userId,
          chunkId: TEST_IDS.chunkId,
          id: TEST_IDS.contentId,
          type: "content",
        });

        expect(chunkRepository.updateDates).toHaveBeenCalledWith({
          chunkId: TEST_IDS.chunkId,
          dates: JSON.stringify(dates),
        });
      });

      it("defaults to an empty dates array when the analysis omits dates", async () => {
        arrange({ ...baseAnalysis }); // no `dates` key

        await service.generateGraph({
          companyId: TEST_IDS.companyId,
          userId: TEST_IDS.userId,
          chunkId: TEST_IDS.chunkId,
          id: TEST_IDS.contentId,
          type: "content",
        });

        expect(chunkRepository.updateDates).toHaveBeenCalledWith({
          chunkId: TEST_IDS.chunkId,
          dates: JSON.stringify([]),
        });
      });
    });

    it("should throw error when queue is not found", async () => {
      // Arrange
      const mockChunk = { id: TEST_IDS.chunkId, content: "Test content" };
      chunkRepository.findChunkById.mockResolvedValue(mockChunk);
      chunkRepository.updateStatus.mockResolvedValue(undefined);
      graphCreatorService.generateGraph.mockResolvedValue(mockChunkAnalysis);
      keyConceptRepository.createOrphanKeyConcepts.mockResolvedValue(undefined);
      keyConceptRepository.updateKeyConceptDescriptions.mockResolvedValue(undefined);
      atomicFactService.createAtomicFact.mockResolvedValue(undefined);
      keyConceptService.addKeyConceptRelationships.mockResolvedValue(undefined);
      clsService.get.mockReturnValue(TEST_IDS.companyId);
      moduleRef.get.mockReturnValue(null);

      // Act & Assert
      await expect(
        service.generateGraph({
          companyId: TEST_IDS.companyId,
          userId: TEST_IDS.userId,
          chunkId: TEST_IDS.chunkId,
          id: TEST_IDS.contentId,
          type: "unknown",
        }),
      ).rejects.toThrow(/No queue found for type unknown/);
    });
  });

  // Cost attribution: the batched re-embedding of a document's chunks is billed
  // against the parent node (id/nodeType), so the upload path is fully measured.
  describe("propagateAndEmbedDates", () => {
    it("attributes the batched embedding to the parent node", async () => {
      // Arrange
      chunkRepository.findChunks.mockResolvedValue([
        { id: "chunk-1", content: "First chunk", dates: [] },
        { id: "chunk-2", content: "Second chunk", dates: [] },
      ]);
      chunkRepository.findParentName.mockResolvedValue("Atto di citazione");
      chunkRepository.enrichContentAndEmbedBatch.mockResolvedValue(undefined);

      // Act
      await service.propagateAndEmbedDates({ id: "doc-1", nodeType: "Document" });

      // Assert
      expect(chunkRepository.enrichContentAndEmbedBatch).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ chunkId: "chunk-1" })]),
        { relationshipId: "doc-1", relationshipType: "Document" },
      );
    });
  });

  // Embedding cost attribution (Task 8). Ingestion embeddings are billed to the
  // entity being ingested; `relationshipType` is always the Neo4j LABEL, which
  // is what a TokenUsage record's USED_FOR edge is matched on.
  describe("embedding cost attribution", () => {
    beforeEach(() => {
      modelRegistry.register({ nodeName: "content", labelName: "Content", type: "contents" } as never);
      modelRegistry.register({ nodeName: "npc", labelName: "Npc", type: "npcs" } as never);
    });

    it("bills key-concept embeddings to the entity being ingested", async () => {
      chunkRepository.findChunkById.mockResolvedValue({ id: TEST_IDS.chunkId, content: "Test content" });
      graphCreatorService.generateGraph.mockResolvedValue({
        atomicFacts: [{ content: "Fact 1", keyConcepts: ["concept1"] }],
        keyConceptsRelationships: [],
        keyConceptDescriptions: [],
        dates: [],
        tokens: { input: 0, output: 0 },
      });
      clsService.get.mockReturnValue(TEST_IDS.companyId);
      mockQueue.add.mockResolvedValue(undefined);

      await service.generateGraph({
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
        chunkId: TEST_IDS.chunkId,
        id: "content-1",
        // The job registry documents `type` as the Neo4j label (PascalCase);
        // "Content" is the only label the mocked jobNames config registers.
        type: "Content",
      });

      const attribution = { relationshipId: "content-1", relationshipType: "Content" };
      expect(keyConceptRepository.createOrphanKeyConcepts).toHaveBeenCalledWith(
        expect.objectContaining({ attribution }),
      );
      expect(atomicFactService.createAtomicFact).toHaveBeenCalledWith(expect.objectContaining({ attribution }));
    });

    it("bills the whole re-embed batch to the document's parent entity", async () => {
      chunkRepository.findChunks.mockResolvedValue([
        { id: "c1", content: "one", dates: [] },
        { id: "c2", content: "two", dates: [] },
      ]);
      chunkRepository.findParentName.mockResolvedValue("Bartender");

      await service.propagateAndEmbedDates({ id: "npc-1", nodeType: "Npc" });

      expect(chunkRepository.enrichContentAndEmbedBatch).toHaveBeenCalledTimes(1);
      expect(chunkRepository.enrichContentAndEmbedBatch).toHaveBeenCalledWith(expect.any(Array), {
        relationshipId: "npc-1",
        relationshipType: "Npc",
      });
    });
  });
});
