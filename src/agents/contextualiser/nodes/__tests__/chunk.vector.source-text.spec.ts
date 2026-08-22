import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextualiserContextState } from "../../contexts/contextualiser.context";
import { RetrievalSourceContribution } from "../../interfaces/retrieval.source.interface";
import { ChunkVectorNodeService } from "../chunk.vector.node.service";

const MOCK_COMPANY_ID = "550e8400-e29b-41d4-a716-446655440000";
const MOCK_CONTENT_ID = "660e8400-e29b-41d4-a716-446655440001";

const createState = (overrides?: Partial<ContextualiserContextState>): ContextualiserContextState =>
  ({
    companyId: MOCK_COMPANY_ID,
    contentId: MOCK_CONTENT_ID,
    contentType: "HowTo",
    hops: 0,
    limits: {},
    question: "Qual è il termine?",
    rationalPlan: "Test rational plan",
    notebook: [],
    status: [],
    processedChunks: [],
    nextStep: "key_concepts",
    tokens: { input: 0, output: 0 },
    ...overrides,
  }) as ContextualiserContextState;

/**
 * The chunk_vector node no longer paraphrases: the retrieved source text goes
 * into the notebook verbatim (neighbour-widened), so the answer node has
 * something it can actually quote. These tests pin that contract.
 */
describe("chunk_vector source text", () => {
  let llmService: { call: ReturnType<typeof vi.fn> };
  let chunkRepository: {
    findPotentialChunks: ReturnType<typeof vi.fn>;
    findChunkNeighbors: ReturnType<typeof vi.fn>;
  };
  let embedderService: { vectoriseText: ReturnType<typeof vi.fn> };

  const build = (sources?: RetrievalSourceContribution[]): ChunkVectorNodeService =>
    new ChunkVectorNodeService(chunkRepository as any, embedderService as any, sources);

  beforeEach(() => {
    llmService = { call: vi.fn() };
    chunkRepository = {
      findPotentialChunks: vi.fn().mockResolvedValue([
        { id: "c1", content: "Il termine è di quindici giorni.", score: 0.82 },
        { id: "c2", content: "Cessione vietata.", score: 0.61 },
      ]),
      findChunkNeighbors: vi.fn().mockResolvedValue([]),
    };
    embedderService = { vectoriseText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
  });

  it("makes no provider call and puts the chunk's own text on the notebook", async () => {
    const result = await build().execute({ state: createState() });

    expect(llmService.call).not.toHaveBeenCalled();
    expect(result.llmCalls).toBe(0);
    expect(result.notebook).toHaveLength(2);
    expect(result.notebook![0].content).toContain("quindici giorni");
    expect(result.notebook![0].score).toBe(0.82);
    expect(result.notebook![1].score).toBe(0.61);
    expect(result.tokens).toEqual({ input: 0, output: 0 });
    expect(result.processedChunks).toEqual(["c1", "c2"]);
  });

  it("passes app-contributed entries through unchanged, keeping their source layer", async () => {
    const contribution: RetrievalSourceContribution = {
      search: async () => [
        {
          chunkId: "m1",
          content: "Massima: il termine decorre dalla notifica.",
          reason: "massima pertinente",
          sourceLayer: "massima",
          metadata: { refId: "j1" },
        },
      ],
    };

    const result = await build([contribution]).execute({ state: createState() });

    expect(result.notebook).toContainEqual({
      chunkId: "m1",
      content: "Massima: il termine decorre dalla notifica.",
      reason: "massima pertinente",
      sourceLayer: "massima",
      metadata: { refId: "j1" },
      score: undefined,
    });
  });

  it("skips a chunk whose content is empty or whitespace", async () => {
    chunkRepository.findPotentialChunks.mockResolvedValue([
      { id: "c1", content: "   ", score: 0.9 },
      { id: "c2", content: "Cessione vietata.", score: 0.61 },
    ]);

    const result = await build().execute({ state: createState() });

    expect(result.notebook).toHaveLength(1);
    expect(result.notebook![0].chunkId).toBe("c2");
  });

  it("carries the unwidened chunk text as coreContent next to the widened content", async () => {
    chunkRepository.findPotentialChunks.mockResolvedValue([{ id: "chunk-1", content: "CORE", score: 0.9 }]);
    chunkRepository.findChunkNeighbors.mockResolvedValue([{ chunkId: "chunk-1", before: ["B"], after: ["A"] }]);

    const result = await build().execute({ state: createState() });

    const entry = result.notebook!.find((n) => n.chunkId === "chunk-1");
    expect(entry!.content).toBe("B\n\nCORE\n\nA");
    expect(entry!.coreContent).toBe("CORE");
  });

  it("leaves coreContent undefined on contributed entries", async () => {
    const contribution: RetrievalSourceContribution = {
      search: async () => [
        {
          chunkId: "m1",
          content: "Massima: il termine decorre dalla notifica.",
          reason: "massima pertinente",
          sourceLayer: "law",
          metadata: { refId: "j1" },
        },
      ],
    };

    const result = await build([contribution]).execute({ state: createState() });

    const law = result.notebook!.find((n) => n.sourceLayer === "law");
    expect(law!.coreContent).toBeUndefined();
  });
});
