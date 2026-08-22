import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextualiserContextState } from "../../contexts/contextualiser.context";
import { ChunkNodeService } from "../chunk.node.service";

/**
 * Task F — chunks node batch hydration. Before this change the node hydrated
 * queued chunks with a `while` loop doing one `findChunkById` round trip per
 * chunk (up to 45 on a measured turn). It must now hydrate every queued chunk
 * in ONE `findChunksByIds` call, exactly as `findChunkNeighbors` already does
 * for neighbour ids.
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
  const chunkRepository = {
    findChunksByIds: vi.fn().mockResolvedValue([]),
    findChunkNeighbors: vi.fn().mockResolvedValue([]),
    findChunkById: vi.fn(),
  };

  const node = new ChunkNodeService(chunkRepository as never);

  return { node, chunkRepository };
};

describe("chunks node hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches all queued chunks in one repository call", async () => {
    const { node, chunkRepository } = buildChunkNodeUnderTest();
    chunkRepository.findChunksByIds.mockResolvedValue([
      { id: "c1", content: "one" },
      { id: "c2", content: "two" },
      { id: "c3", content: "three" },
    ]);

    await node.execute({
      state: { ...baseState(), queuedChunks: ["c1", "c2", "c3"], processedChunks: [] } as never,
    });

    expect(chunkRepository.findChunksByIds).toHaveBeenCalledTimes(1);
    expect(chunkRepository.findChunkById).not.toHaveBeenCalled();
  });

  it("still skips chunks already processed", async () => {
    const { node, chunkRepository } = buildChunkNodeUnderTest();
    chunkRepository.findChunksByIds.mockResolvedValue([{ id: "c2", content: "two" }]);

    await node.execute({
      state: { ...baseState(), queuedChunks: ["c1", "c2"], processedChunks: ["c1"] } as never,
    });

    expect(chunkRepository.findChunksByIds).toHaveBeenCalledWith(expect.objectContaining({ chunkIds: ["c2"] }));
  });
});
