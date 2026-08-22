import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ResponderService } from "../../agents/responder/services/responder.service";
import { AgentMessageType } from "../../common/enums/agentmessage.type";
import { BaseConfigInterface } from "../../config/interfaces/base.config.interface";
import { ConfigAiInterface } from "../../config/interfaces/config.ai.interface";
import { EvidenceMatcher } from "./evidence.matcher";
import { EndToEndSweepResult, EvalQuestionSet, SweepSummary } from "./retrieval-eval.types";
import { RubricJudgeService } from "./rubric-judge.service";
import { TokenAccountingChecker } from "./token-accounting.check";

/**
 * The metric of record (spec §6.4): a full assistant turn per question, in the
 * product's own voice, with its own prompts and temperature.
 *
 * Sequential on purpose — `answerMs` is a reported metric (spec §6.3).
 */
@Injectable()
export class EndToEndSweepService {
  private readonly logger = new Logger(EndToEndSweepService.name);

  constructor(
    private readonly responder: ResponderService,
    private readonly judge: RubricJudgeService,
    private readonly evidence: EvidenceMatcher,
    private readonly accounting: TokenAccountingChecker,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  /**
   * SCOPE COMES FROM CLS, NOT FROM THESE PARAMETERS.
   *
   * `companyId` and `userId` stay because `ResponderService.run` genuinely takes
   * them — but they do not scope retrieval. Company scope reaches the
   * `ChunkRepository` through `ClsService` (via `Neo4jService.initQuery`), and
   * the run's scope root through `AGENT_SCOPE_CLS_KEY`
   * (`common/repositories/agent-scope.filter.ts`), which fails closed. A caller
   * that does not establish that context retrieves nothing — or, worse,
   * retrieves unscoped. Establishing it is the entry point's job; see
   * apps/api/src/eval/run-sweep.ts.
   */
  async run(params: {
    set: EvalQuestionSet;
    companyId: string;
    userId: string;
  }): Promise<SweepSummary<EndToEndSweepResult>> {
    const startedAt = new Date().toISOString();
    const results: EndToEndSweepResult[] = [];

    for (const question of params.set.questions) {
      const began = Date.now();
      try {
        const response = await this.responder.run({
          companyId: params.companyId,
          userId: params.userId,
          userModuleIds: [],
          dataLimits: {},
          messages: [{ type: AgentMessageType.User, content: question.question }],
          question: question.question,
          scopeId: question.scopeId,
          scopeType: question.scopeType,
        });

        const notebook = response.context?.notebook ?? [];
        const retrievedText = notebook.map((entry) => entry.content ?? "").join("\n\n");
        const retrieved = this.evidence.score({
          snippets: question.mustRetrieve,
          haystack: retrievedText,
        });

        const citedIds = new Set((response.sources ?? []).map((source) => source.chunkId));
        const citedText = notebook
          .filter((entry) => citedIds.has(entry.chunkId))
          .map((entry) => entry.content ?? "")
          .join("\n\n");
        const cited = this.evidence.score({ snippets: question.mustRetrieve, haystack: citedText });

        // Post-trim: only the notebook entries that survived NOTEBOOK_BUDGET_CHARS
        // and reached the answer model (contract C1). Absent `keptChunkIds` means
        // the answer node never reported which entries it kept — treat as "not
        // observed", never as "nothing kept" (see the interface's own doc comment).
        const keptChunkIds = response.trace?.answer?.keptChunkIds;
        const readObserved = Array.isArray(keptChunkIds);
        const keptSet = new Set(keptChunkIds ?? []);
        // Subset of keptSet kept in core (unwidened) form (contract C2/C3): their
        // ±1 neighbour text never reached the model, so scoring must read only
        // `coreContent` for these — never credit the widened `content`.
        const coreOnlyIds = new Set(response.trace?.answer?.coreOnlyChunkIds ?? []);
        const readText = readObserved
          ? notebook
              .filter((entry) => keptSet.has(entry.chunkId))
              .map((entry) => (coreOnlyIds.has(entry.chunkId) ? (entry.coreContent ?? "") : (entry.content ?? "")))
              .join("\n\n")
          : "";
        const read = this.evidence.score({ snippets: question.mustRetrieve, haystack: readText });

        const answer = response.answer?.answer ?? "";
        const verdict = await this.judge.judge({
          question: question.question,
          rubric: question.rubric,
          answer,
          evidenceCited: cited.found,
        });

        const ledger = response.tokens ?? { input: 0, output: 0 };
        this.observeReportedCalls(response.trace);

        results.push({
          questionId: question.id,
          evidenceRetrieved: retrieved.found,
          missingSnippets: retrieved.missing,
          evidenceCited: cited.found,
          uncitedSnippets: cited.missing,
          chunksRead: notebook.length,
          // The turn does not report retrieval separately from the answer;
          // `retrievalMs` is the retrieval-only mode's metric (spec §6.5).
          retrievalMs: 0,
          answerMs: Date.now() - began,
          inputTokens: ledger.input ?? 0,
          outputTokens: ledger.output ?? 0,
          verdict,
          tokenAccounting: this.accounting.check({ questionId: question.id, ledger }),
          evidenceRead: readObserved ? read.found : 0,
          chunksKept: keptSet.size,
          chunksKeptCore: readObserved ? coreOnlyIds.size : 0,
          readObserved,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`end-to-end sweep: question ${question.id} failed: ${message}`);
        // The turn died part-way, so `check()` never ran and never reset. Anything
        // this question already observed must be cleared here or the next question
        // inherits it and its own comparison is meaningless.
        this.accounting.reset();
        results.push({
          questionId: question.id,
          evidenceRetrieved: 0,
          missingSnippets: question.mustRetrieve,
          evidenceCited: 0,
          uncitedSnippets: question.mustRetrieve,
          chunksRead: 0,
          retrievalMs: 0,
          answerMs: Date.now() - began,
          inputTokens: 0,
          outputTokens: 0,
          verdict: { passed: false, explanation: `Turn failed: ${message}` },
          tokenAccounting: {
            ledgerInput: 0,
            observedInput: 0,
            ledgerOutput: 0,
            observedOutput: 0,
            agrees: false,
            checked: false,
          },
          evidenceRead: 0,
          chunksKept: 0,
          chunksKeptCore: 0,
          readObserved: false,
          error: message,
        });
      }
    }

    return {
      product: params.set.product,
      mode: "end-to-end",
      model: this.configService.get<ConfigAiInterface>("ai")?.ai?.model ?? "unknown",
      startedAt,
      results,
    };
  }

  /**
   * Feeds the checker the per-node figures the turn itself reported, so
   * `check()` compares them against the accumulated ledger.
   *
   * Spec §6.5 asks the sweep to sum the per-call figures and cross-check the
   * aggregate. The trace is where those per-node figures survive: each node
   * records what its own provider calls reported, while `response.tokens` is
   * the reducer-accumulated total — the exact pair whose disagreement IS the
   * §1.1 double-count. Without this the checker would see zero observed tokens
   * and declare a mismatch on every question, which is noise, not a check.
   */
  private observeReportedCalls(trace: {
    planner?: { tokens?: { input: number; output: number } };
    graph?: { tokens?: { input: number; output: number } };
    contextualiser?: { tokens?: { input: number; output: number } };
    drift?: { tokens?: { input: number; output: number } };
    answer?: { tokens?: { input: number; output: number } };
  }): void {
    for (const node of [trace?.planner, trace?.graph, trace?.contextualiser, trace?.drift, trace?.answer]) {
      if (node?.tokens) this.accounting.observe({ input: node.tokens.input, output: node.tokens.output });
    }
  }
}
