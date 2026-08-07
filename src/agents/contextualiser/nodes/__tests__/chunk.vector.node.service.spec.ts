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
  let llmService: { call: ReturnType<typeof vi.fn> };
  let chunkRepository: {
    findPotentialChunks: ReturnType<typeof vi.fn>;
    findChunkNeighbors: ReturnType<typeof vi.fn>;
  };
  let webSocketService: { sendMessageToUser: ReturnType<typeof vi.fn> };
  let clsService: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };

  const build = (sources?: RetrievalSourceContribution[]): ChunkVectorNodeService =>
    new ChunkVectorNodeService(
      llmService as any,
      chunkRepository as any,
      webSocketService as any,
      clsService as any,
      configService as any,
      sources,
    );

  beforeEach(() => {
    llmService = {
      call: vi.fn().mockResolvedValue({
        status: "s",
        note: { content: "c", reason: "r" },
        chosenAction: "answer",
        tokenUsage: { input: 1, output: 1 },
      }),
    };
    chunkRepository = {
      findPotentialChunks: vi.fn().mockResolvedValue([{ id: "c1", content: "text" }]),
      findChunkNeighbors: vi.fn().mockResolvedValue([]),
    };
    webSocketService = { sendMessageToUser: vi.fn() };
    clsService = { get: vi.fn(), set: vi.fn() };
    configService = { get: vi.fn().mockReturnValue({}) };
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
      { chunkId: "c1", content: "c", reason: "r", sourceLayer: "case", metadata: undefined },
      { chunkId: "m1", content: "[X] y", reason: "z", sourceLayer: "external", metadata: { refId: "j1" } },
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

  it("returns an empty patch when neither the vector search nor the contributions produce anything", async () => {
    chunkRepository.findPotentialChunks.mockResolvedValue([]);
    const service = build([{ search: async () => [] }]);

    const result = await service.execute({ state: createState() });

    expect(result).toEqual({});
    expect(llmService.call).not.toHaveBeenCalled();
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
      { chunkId: "c1", content: "c", reason: "r", sourceLayer: "case", metadata: undefined },
    ]);
  });

  it("widens each chunk with its neighbours before handing it to the LLM", async () => {
    chunkRepository.findChunkNeighbors.mockResolvedValue([{ chunkId: "c1", before: ["prev"], after: ["next"] }]);
    const service = build();

    await service.execute({ state: createState() });

    expect(chunkRepository.findChunkNeighbors).toHaveBeenCalledWith({ chunkIds: ["c1"], window: 1 });
    expect(llmService.call).toHaveBeenCalledWith(
      expect.objectContaining({
        inputParams: expect.objectContaining({ text: "prev\n\ntext\n\nnext" }),
      }),
    );
  });

  it("works without any contributed retrieval sources", async () => {
    const service = build();

    const result = await service.execute({ state: createState() });

    expect(result.notebook).toHaveLength(1);
    expect(result.tokens).toEqual({ input: 1, output: 1 });
  });
});
