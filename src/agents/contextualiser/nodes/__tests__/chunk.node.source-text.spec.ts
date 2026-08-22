import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextualiserContextState } from "../../contexts/contextualiser.context";
import { ChunkNodeService } from "../chunk.node.service";

/**
 * Task 3c-G — the graph walk stops paraphrasing. The chunks node used to run
 * one LLM call per queued chunk to decide relevance, write a note and pick a
 * `chosenAction` that routed the graph. It now reads the chunks the graph walk
 * already selected, carries their SOURCE TEXT (widened by one neighbour either
 * side) into the notebook with the cosine score the repository attached, and
 * follows `state.nextStep`.
 *
 * There is deliberately NO relevance bar and NO chunk-count cap here: the
 * calibration measured the spec's relative floor as inert on this corpus and a
 * cap of 8 as lossy. The notebook character budget in the responder answer node
 * is the single thing that decides what reaches the answer, which is why the
 * entries are handed over sorted best-score-first.
 */

const baseState = (overrides?: Partial<ContextualiserContextState>): ContextualiserContextState =>
  ({
    companyId: "company-1",
    contentId: "content-1",
    contentType: "HowTo",
    hops: 0,
    chunkLevel: 0,
    limits: {},
    question: "Test question",
    rationalPlan: "Test rational plan",
    notebook: [],
    status: [],
    processedChunks: [],
    queuedChunks: [],
    neighbouringAlreadyExplored: false,
    nextStep: "chunks",
    tokens: { input: 0, output: 0 },
    ...overrides,
  }) as ContextualiserContextState;

const buildChunkNodeUnderTest = () => {
  const llmService = { call: vi.fn() };
  const chunkRepository = {
    findChunksByIds: vi.fn().mockResolvedValue([]),
    findChunkNeighbors: vi.fn().mockResolvedValue([]),
    findChunkById: vi.fn(),
    findSubsequentChunkId: vi.fn().mockResolvedValue(undefined),
    findPreviousChunkId: vi.fn().mockResolvedValue(undefined),
  };

  const node = new ChunkNodeService(chunkRepository as never);

  return { node, llmService, chunkRepository };
};

describe("chunks node without per-chunk LLM calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makes no provider call and carries every scored chunk's source text", async () => {
    const { node, llmService, chunkRepository } = buildChunkNodeUnderTest();
    chunkRepository.findChunksByIds.mockResolvedValue([
      { id: "c1", content: "fatto rilevante", score: 0.77 },
      { id: "c2", content: "irrilevante", score: 0.12 },
    ]);

    const result = await node.execute({
      state: { ...baseState(), queuedChunks: ["c1", "c2"], questionEmbedding: [0.1] } as never,
    });

    expect(llmService.call).not.toHaveBeenCalled();
    expect(result.llmCalls).toBe(0);

    const entries = result.notebook ?? [];
    expect(entries.map((entry) => entry.chunkId)).toEqual(expect.arrayContaining(["c1", "c2"]));
    expect(entries.find((entry) => entry.chunkId === "c1")?.content).toBe("fatto rilevante");
    expect(entries.find((entry) => entry.chunkId === "c2")?.content).toBe("irrilevante");
    expect((entries.find((entry) => entry.chunkId === "c1") as { score?: number }).score).toBe(0.77);
    expect((entries.find((entry) => entry.chunkId === "c2") as { score?: number }).score).toBe(0.12);
  });

  it("passes the question embedding to the repository", async () => {
    const { node, chunkRepository } = buildChunkNodeUnderTest();
    chunkRepository.findChunksByIds.mockResolvedValue([{ id: "c1", content: "text", score: 0.5 }]);

    await node.execute({
      state: { ...baseState(), queuedChunks: ["c1"], questionEmbedding: [0.1, 0.2] } as never,
    });

    expect(chunkRepository.findChunksByIds).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIds: ["c1"], queryEmbedding: [0.1, 0.2] }),
    );
  });

  it("orders the notebook entries best-score-first", async () => {
    const { node, chunkRepository } = buildChunkNodeUnderTest();
    chunkRepository.findChunksByIds.mockResolvedValue([
      { id: "low", content: "low", score: 0.2 },
      { id: "high", content: "high", score: 0.9 },
      { id: "mid", content: "mid", score: 0.5 },
    ]);

    const result = await node.execute({
      state: { ...baseState(), queuedChunks: ["low", "high", "mid"], questionEmbedding: [0.1] } as never,
    });

    expect((result.notebook ?? []).map((entry) => entry.chunkId)).toEqual(["high", "mid", "low"]);
  });

  it("widens each entry with its neighbouring chunks", async () => {
    const { node, chunkRepository } = buildChunkNodeUnderTest();
    chunkRepository.findChunksByIds.mockResolvedValue([{ id: "c1", content: "middle", score: 0.8 }]);
    chunkRepository.findChunkNeighbors.mockResolvedValue([{ chunkId: "c1", before: ["prima"], after: ["dopo"] }]);

    const result = await node.execute({
      state: { ...baseState(), queuedChunks: ["c1"], questionEmbedding: [0.1] } as never,
    });

    expect(chunkRepository.findChunkNeighbors).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIds: ["c1"], window: 1 }),
    );
    expect((result.notebook ?? [])[0]?.content).toBe("prima\n\nmiddle\n\ndopo");
  });

  it("carries the unwidened chunk text as coreContent next to the widened content", async () => {
    const { node, chunkRepository } = buildChunkNodeUnderTest();
    chunkRepository.findChunksByIds.mockResolvedValue([{ id: "c1", content: "CORE", score: 0.8 }]);
    chunkRepository.findChunkNeighbors.mockResolvedValue([{ chunkId: "c1", before: ["prima"], after: ["dopo"] }]);

    const result = await node.execute({
      state: { ...baseState(), queuedChunks: ["c1"], questionEmbedding: [0.1] } as never,
    });

    const entry = (result.notebook ?? [])[0];
    expect(entry?.content).toContain(entry?.coreContent as string);
    expect(entry?.coreContent).toBe("CORE");
  });

  it("no longer tracks chunkLevel or chosenAction", () => {
    const source = readFileSync(join(__dirname, "..", "chunk.node.service.ts"), "utf8");
    expect(source).not.toMatch(/chunkLevel/);
    expect(source).not.toMatch(/chosenAction/);
  });
});
