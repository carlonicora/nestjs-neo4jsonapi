import { Injectable, Logger } from "@nestjs/common";
import { ChunkRepository } from "../../../foundations/chunk/repositories/chunk.repository";
import {
  ContextualiserContext,
  ContextualiserContextState,
} from "../../contextualiser/contexts/contextualiser.context";
import { NotebookContext } from "../../contextualiser/contexts/notebook.context";

/**
 * How many chunks either side of a retrieved chunk are read with it. The same
 * value, for the same reason, as in `chunk.vector.node.service.ts`: a chunk
 * boundary is an artefact of the splitter, not of the document, so the sentence
 * that completes a fact often sits one chunk away. Duplicating one integer is
 * cheaper than a shared import across two node files; the value is documented
 * in both.
 */
const NEIGHBOR_WINDOW = 1;

@Injectable()
export class ChunkNodeService {
  private readonly logger = new Logger(ChunkNodeService.name);

  constructor(private readonly chunkRepository: ChunkRepository) {}

  async execute(params: { state: typeof ContextualiserContext.State }): Promise<Partial<ContextualiserContextState>> {
    if (params.state.queuedChunks.length === 0) {
      this.logger.warn(
        `chunks → ${params.state.neighbouringAlreadyExplored ? "answer" : "neighbouring_nodes"} ` +
          `(no queued chunks): processedChunks=${params.state.processedChunks.length}`,
      );
      return {
        llmCalls: 0,
        nextStep: params.state.neighbouringAlreadyExplored ? "answer" : "neighbouring_nodes",
      };
    }

    const chunkIdsToProcess = params.state.queuedChunks.filter(
      (chunkId) => !params.state.processedChunks.includes(chunkId),
    );

    const fetched = await this.chunkRepository.findChunksByIds({
      chunkIds: chunkIdsToProcess,
      dataLimits: params.state.limits,
      queryEmbedding: params.state.questionEmbedding,
    });

    this.logger.log(
      `chunk lookup → ${fetched.length}/${chunkIdsToProcess.length} chunks found by id ` +
        `(missing=${chunkIdsToProcess.length - fetched.length})`,
    );

    if (fetched.length === 0) {
      this.logger.warn(
        `chunks → ${params.state.neighbouringAlreadyExplored ? "answer" : "neighbouring_nodes"} ` +
          `(0 chunks resolved from ${chunkIdsToProcess.length} ids — chunkIds may belong to deleted HowTos or company-scoped MATCH failed)`,
      );
      return {
        queuedChunks: [],
        llmCalls: 0,
        nextStep: params.state.neighbouringAlreadyExplored ? "answer" : "neighbouring_nodes",
      };
    }

    // Every fetched chunk is kept. Filtering by score was measured to be
    // either inert (the relative bar admits everything on this corpus) or
    // lossy (a count cap of 8 loses required evidence), so the notebook
    // character budget in responder.answer.node.service.ts is what decides
    // what reaches the answer. Ordering is how the budget knows what to drop.
    const kept = [...fetched].sort(
      (a, b) => ((b as { score?: number }).score ?? 0) - ((a as { score?: number }).score ?? 0),
    );

    // Neighbour-window widening: each chunk is carried into the notebook
    // together with the chunks immediately before/after it, so the answer node
    // reads continuous prose instead of a splitter's arbitrary slice. This is
    // the automatic replacement for the per-chunk LLM decision that used to
    // queue a previous/next chunk for another round.
    const neighborRecords = await this.chunkRepository.findChunkNeighbors({
      chunkIds: kept.map((chunk) => chunk.id),
      window: NEIGHBOR_WINDOW,
    });
    const neighborById = new Map(neighborRecords.map((neighbour) => [neighbour.chunkId, neighbour]));

    const newNotebookEntries: (typeof NotebookContext.State)[] = kept
      .filter((chunk) => chunk.content && chunk.content.trim() !== "")
      .map((chunk) => {
        const neighbours = neighborById.get(chunk.id);
        return {
          chunkId: chunk.id,
          content: neighbours ? [...neighbours.before, chunk.content, ...neighbours.after].join("\n\n") : chunk.content,
          reason: "",
          sourceLayer: "case",
          metadata: undefined,
          score: (chunk as { score?: number }).score,
          coreContent: chunk.content,
        };
      });

    return {
      hops: params.state.hops + 1,
      llmCalls: 0,
      notebook: newNotebookEntries,
      processedChunks: fetched.map((chunk) => chunk.id),
      queuedChunks: [],
      nextStep: params.state.neighbouringAlreadyExplored ? "answer" : "neighbouring_nodes",
      tokens: { input: 0, output: 0 },
    };
  }
}
