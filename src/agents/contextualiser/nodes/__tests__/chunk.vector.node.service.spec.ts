import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextualiserContextState } from "../../contexts/contextualiser.context";
import { RetrievalSourceContribution } from "../../interfaces/retrieval.source.interface";
import { ChunkVectorNodeService } from "../chunk.vector.node.service";
import { modelRegistry } from "../../../../common/registries/registry";

const MOCK_COMPANY_ID = "550e8400-e29b-41d4-a716-446655440000";
const MOCK_CONTENT_ID = "660e8400-e29b-41d4-a716-446655440001";

const createState = (overrides?: Partial<ContextualiserContextState>): ContextualiserContextState =>
  ({
    companyId: MOCK_COMPANY_ID,
    contentId: MOCK_CONTENT_ID,
    contentType: "HowTo",
    hops: 0,
    limits: {},
    question: "Test question",
    rationalPlan: "Test rational plan",
    notebook: [],
    status: [],
    processedChunks: [],
    nextStep: "key_concepts",
    tokens: { input: 0, output: 0 },
    ...overrides,
  }) as ContextualiserContextState;

describe("ChunkVectorNodeService", () => {
  let chunkRepository: {
    findPotentialChunks: ReturnType<typeof vi.fn>;
    findChunkNeighbors: ReturnType<typeof vi.fn>;
  };
  let embedderService: { vectoriseText: ReturnType<typeof vi.fn> };

  const build = (sources?: RetrievalSourceContribution[]): ChunkVectorNodeService =>
    new ChunkVectorNodeService(chunkRepository as any, embedderService as any, sources);

  beforeEach(() => {
    chunkRepository = {
      findPotentialChunks: vi.fn().mockResolvedValue([{ id: "c1", content: "text" }]),
      findChunkNeighbors: vi.fn().mockResolvedValue([]),
    };
    embedderService = { vectoriseText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
  });

  it("merges contributed retrieval entries into the notebook alongside the package's own chunks", async () => {
    const contribution: RetrievalSourceContribution = {
      search: async () => [
        { chunkId: "m1", content: "[X] y", reason: "z", sourceLayer: "external", metadata: { refId: "j1" } },
      ],
    };
    const service = build([contribution]);

    const result = await service.execute({ state: createState() });

    expect(result.notebook).toEqual([
      {
        chunkId: "c1",
        content: "text",
        coreContent: "text",
        reason: "",
        sourceLayer: "case",
        metadata: undefined,
        score: undefined,
      },
      {
        chunkId: "m1",
        content: "[X] y",
        coreContent: undefined,
        reason: "z",
        sourceLayer: "external",
        metadata: { refId: "j1" },
        score: undefined,
      },
    ]);
    expect(result.processedChunks).toEqual(["c1"]);
    expect(result.hops).toBe(1);
  });

  it("passes the turn context to every contributed retrieval source", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const service = build([{ search }]);

    await service.execute({ state: createState({ limits: { howToMode: true } }) });

    expect(search).toHaveBeenCalledWith({
      question: "Test question",
      rationalPlan: "Test rational plan",
      companyId: MOCK_COMPANY_ID,
      dataLimits: { howToMode: true },
    });
  });

  it("returns an empty patch (bar the shared question embedding) when neither the vector search nor the contributions produce anything", async () => {
    chunkRepository.findPotentialChunks.mockResolvedValue([]);
    const service = build([{ search: async () => [] }]);

    const result = await service.execute({ state: createState() });

    // A turn that retrieves nothing must still share the embedding with key_concepts,
    // and must report that it spent nothing of the run's call budget.
    expect(result).toEqual({ llmCalls: 0, questionEmbedding: expect.any(Array) });
  });

  it("swallows a failing contribution and still returns the chunks it did retrieve", async () => {
    const service = build([
      {
        search: async () => {
          throw new Error("upstream down");
        },
      },
    ]);

    const result = await service.execute({ state: createState() });

    expect(result.notebook).toEqual([
      {
        chunkId: "c1",
        content: "text",
        coreContent: "text",
        reason: "",
        sourceLayer: "case",
        metadata: undefined,
        score: undefined,
      },
    ]);
  });

  it("widens each chunk with its neighbours before writing it to the notebook", async () => {
    chunkRepository.findChunkNeighbors.mockResolvedValue([{ chunkId: "c1", before: ["prev"], after: ["next"] }]);
    const service = build();

    const result = await service.execute({ state: createState() });

    expect(chunkRepository.findChunkNeighbors).toHaveBeenCalledWith({ chunkIds: ["c1"], window: 1 });
    expect(result.notebook?.[0].content).toBe("prev\n\ntext\n\nnext");
  });

  it("works without any contributed retrieval sources", async () => {
    const service = build();

    const result = await service.execute({ state: createState() });

    expect(result.notebook).toHaveLength(1);
    // The node no longer calls a model, so it spends no tokens of its own.
    expect(result.tokens).toEqual({ input: 0, output: 0 });
    expect(result.llmCalls).toBe(0);
  });
  // Embedding cost attribution (Task 8). The question embedding this node
  // triggers is billed to the scope the retrieval searches.
  describe("embedding cost attribution", () => {
    it("bills the retrieval to the content the run is bound to", async () => {
      modelRegistry.register({ nodeName: "campaign", labelName: "Campaign", type: "campaigns" } as never);

      await build().execute({ state: createState({ contentId: "campaign-1", contentType: "campaigns" }) });

      expect(chunkRepository.findPotentialChunks).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: { relationshipId: "campaign-1", relationshipType: "Campaign" },
        }),
      );
    });

    it("bills a help-mode retrieval to the HowTo it is limited to", async () => {
      await build().execute({
        state: createState({ contentId: "", contentType: "", limits: { howToMode: true, limitToHowToId: "howto-1" } }),
      });

      expect(chunkRepository.findPotentialChunks).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: { relationshipId: "howto-1", relationshipType: "HowTo" },
        }),
      );
    });

    it("records nothing for an unbound company-wide retrieval", async () => {
      await build().execute({ state: createState({ contentId: "", contentType: "", limits: {} }) });

      expect(chunkRepository.findPotentialChunks).toHaveBeenCalledWith(
        expect.objectContaining({ attribution: undefined }),
      );
    });
  });
});

describe("chunk_vector embedding reuse", () => {
  const MOCK_COMPANY_ID_2 = "550e8400-e29b-41d4-a716-446655440000";
  const MOCK_CONTENT_ID_2 = "660e8400-e29b-41d4-a716-446655440001";

  const createState2 = (overrides?: Partial<ContextualiserContextState>): ContextualiserContextState =>
    ({
      companyId: MOCK_COMPANY_ID_2,
      contentId: MOCK_CONTENT_ID_2,
      contentType: "HowTo",
      hops: 0,
      limits: {},
      question: "Test question",
      rationalPlan: "Test rational plan",
      notebook: [],
      status: [],
      processedChunks: [],
      nextStep: "key_concepts",
      tokens: { input: 0, output: 0 },
      ...overrides,
    }) as ContextualiserContextState;

  let chunkRepository: {
    findPotentialChunks: ReturnType<typeof vi.fn>;
    findChunkNeighbors: ReturnType<typeof vi.fn>;
  };
  let embedderService: { vectoriseText: ReturnType<typeof vi.fn> };

  const build = (): ChunkVectorNodeService =>
    new ChunkVectorNodeService(chunkRepository as any, embedderService as any, undefined);

  beforeEach(() => {
    chunkRepository = {
      findPotentialChunks: vi.fn().mockResolvedValue([{ id: "c1", content: "text" }]),
      findChunkNeighbors: vi.fn().mockResolvedValue([]),
    };
    embedderService = { vectoriseText: vi.fn().mockResolvedValue([0.5, 0.5]) };
  });

  it("passes a precomputed embedding to retrieval and returns it on the state", async () => {
    const node = build();
    const result = await node.execute({ state: createState2() });

    expect(embedderService.vectoriseText).toHaveBeenCalledTimes(1);
    expect(chunkRepository.findPotentialChunks).toHaveBeenCalledWith(
      expect.objectContaining({ queryEmbedding: expect.any(Array) }),
    );
    expect(result.questionEmbedding).toEqual(expect.any(Array));
  });

  it("reuses an embedding already on the state instead of recomputing", async () => {
    const node = build();
    await node.execute({ state: { ...createState2(), questionEmbedding: [0.5, 0.5] } as any });
    expect(embedderService.vectoriseText).not.toHaveBeenCalled();
  });
});
