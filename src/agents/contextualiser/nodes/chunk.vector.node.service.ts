import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { EmbedderService } from "../../../core/llm/services/embedder.service";
import { ChunkRepository } from "../../../foundations/chunk/repositories/chunk.repository";
import { buildRetrievalAttribution } from "../../common/usage-attribution";
import {
  ContextualiserContext,
  ContextualiserContextState,
} from "../../contextualiser/contexts/contextualiser.context";
import { NotebookContext } from "../../contextualiser/contexts/notebook.context";
import { RETRIEVAL_SOURCES, RetrievalSourceContribution } from "../interfaces/retrieval.source.interface";

const NEIGHBOR_WINDOW = 1;

@Injectable()
export class ChunkVectorNodeService {
  private readonly logger = new Logger(ChunkVectorNodeService.name);

  constructor(
    private readonly chunkRepository: ChunkRepository,
    private readonly embedderService: EmbedderService,
    @Optional()
    @Inject(RETRIEVAL_SOURCES)
    private readonly retrievalSources?: RetrievalSourceContribution[],
  ) {}

  async execute(params: { state: typeof ContextualiserContext.State }): Promise<Partial<ContextualiserContextState>> {
    // ONE embedding per turn. findPotentialChunks and findPotentialKeyConcepts
    // were each embedding the identical question string, costing two provider
    // round trips and two ledger rows for one question.
    const queryEmbedding =
      params.state.questionEmbedding ??
      (await this.embedderService.vectoriseText({
        text: params.state.question,
        attribution: buildRetrievalAttribution({
          contentId: params.state.contentId,
          contentType: params.state.contentType,
          dataLimits: params.state.limits,
          scope: params.state,
        }),
      }));

    const [chunks, contributed] = await Promise.all([
      this.chunkRepository.findPotentialChunks({
        question: params.state.question,
        dataLimits: params.state.limits,
        queryEmbedding,
        // The question embedding is billed to the scope this retrieval searches.
        // Task 10 threaded the CALLING agent's own attribution through this
        // state, and it is now the first branch of the derivation: when another
        // agent confined the turn to a scope root, its embedding spend lands on
        // the same entity as its LLM spend instead of on a second one.
        attribution: buildRetrievalAttribution({
          contentId: params.state.contentId,
          contentType: params.state.contentType,
          dataLimits: params.state.limits,
          scope: params.state,
        }),
      }),
      Promise.all(
        (this.retrievalSources ?? []).map((source) =>
          source
            .search({
              question: params.state.question,
              rationalPlan: params.state.rationalPlan,
              companyId: params.state.companyId,
              dataLimits: params.state.limits,
            })
            .catch((e: Error) => {
              this.logger.warn(`retrieval source contribution failed: ${e.message}`);
              return [];
            }),
        ),
      ).then((lists) => lists.flat()),
    ]);

    // Neighbour-window widening: each retrieved chunk carries the chunks
    // immediately before/after it, so what reaches the notebook is continuous
    // prose rather than a sentence cut at both ends.
    const allRetrievedIds = chunks.map((c) => c.id);
    const neighborRecords = allRetrievedIds.length
      ? await this.chunkRepository.findChunkNeighbors({ chunkIds: allRetrievedIds, window: NEIGHBOR_WINDOW })
      : [];
    const neighborById = new Map(neighborRecords.map((n) => [n.chunkId, n]));
    const widen = (id: string, content: string): string => {
      const n = neighborById.get(id);
      if (!n) return content;
      return [...n.before, content, ...n.after].join("\n\n");
    };

    if (chunks.length === 0 && contributed.length === 0) {
      this.logger.log("chunk_vector: no results — continuing per rational plan routing");
      // Nothing to analyse: this path makes no provider call.
      return { llmCalls: 0, questionEmbedding: queryEmbedding };
    }

    // No per-chunk LLM call. It filtered nothing — the notebook push was
    // unconditional — and its paraphrase REPLACED the chunk, so the answer node
    // never saw text it could quote. The widened source text goes through
    // instead, ordered and budgeted downstream (responder.answer.node.service).
    const newNotebookEntries: (typeof NotebookContext.State)[] = [];

    for (const chunk of chunks) {
      if (!chunk.content || chunk.content.trim() === "") continue;
      newNotebookEntries.push({
        chunkId: chunk.id,
        content: widen(chunk.id, chunk.content),
        reason: "",
        sourceLayer: "case",
        metadata: undefined,
        score: (chunk as { score?: number }).score,
        coreContent: chunk.content,
      });
    }

    for (const entry of contributed) {
      newNotebookEntries.push({
        chunkId: entry.chunkId,
        content: entry.content,
        reason: entry.reason,
        sourceLayer: entry.sourceLayer ?? "case",
        metadata: entry.metadata,
        score: undefined,
        coreContent: undefined,
      });
    }

    return {
      hops: params.state.hops + 1,
      llmCalls: 0,
      processedChunks: chunks.map((c) => c.id),
      notebook: newNotebookEntries,
      questionEmbedding: queryEmbedding,
      tokens: { input: 0, output: 0 },
    };
  }
}
