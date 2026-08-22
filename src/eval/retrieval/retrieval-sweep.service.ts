import { Injectable, Logger } from "@nestjs/common";
import { ChunkRepository } from "../../foundations/chunk/repositories/chunk.repository";
import { EvidenceMatcher } from "./evidence.matcher";
import { EvalQuestionSet, RetrievalSweepResult, SweepSummary } from "./retrieval-eval.types";

/**
 * The fast inner loop: asks the retrieval layer what it WOULD read for each
 * question and stops there. No answer is generated, so the only provider call
 * is embedding the question.
 *
 * Questions run SEQUENTIALLY on purpose — `retrievalMs` is a reported metric and
 * concurrency would make it meaningless (spec §6.3).
 */
@Injectable()
export class RetrievalSweepService {
  private readonly logger = new Logger(RetrievalSweepService.name);

  constructor(
    private readonly chunkRepository: ChunkRepository,
    private readonly evidence: EvidenceMatcher,
  ) {}

  /**
   * SCOPE COMES FROM CLS, NOT FROM A PARAMETER.
   *
   * `ChunkRepository` reads company scope from `ClsService` (via
   * `Neo4jService.initQuery`, which pulls `companyId`/`userId` off CLS) and the
   * run's scope root from `AGENT_SCOPE_CLS_KEY`
   * (`common/repositories/agent-scope.filter.ts`), which fails closed. A caller
   * that does not establish that context retrieves nothing — or, worse,
   * retrieves unscoped. The entry point is responsible for it; see
   * apps/api/src/eval/run-sweep.ts.
   *
   * This is why `run` takes no companyId: accepting one would imply it is
   * honoured here, and it is not.
   */
  async run(params: { set: EvalQuestionSet }): Promise<SweepSummary<RetrievalSweepResult>> {
    const startedAt = new Date().toISOString();
    const results: RetrievalSweepResult[] = [];

    for (const question of params.set.questions) {
      const began = Date.now();
      try {
        const chunks = await this.chunkRepository.findPotentialChunks({
          question: question.question,
          dataLimits: {},
        });
        const haystack = chunks.map((chunk) => chunk.content ?? "").join("\n\n");
        const scored = this.evidence.score({ snippets: question.mustRetrieve, haystack });
        results.push({
          questionId: question.id,
          evidenceRetrieved: scored.found,
          missingSnippets: scored.missing,
          chunksRead: chunks.length,
          retrievalMs: Date.now() - began,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`retrieval sweep: question ${question.id} failed: ${message}`);
        results.push({
          questionId: question.id,
          evidenceRetrieved: 0,
          missingSnippets: question.mustRetrieve,
          chunksRead: 0,
          retrievalMs: Date.now() - began,
          error: message,
        });
      }
    }

    return {
      product: params.set.product,
      mode: "retrieval-only",
      model: "n/a — retrieval only",
      startedAt,
      results,
    };
  }
}
