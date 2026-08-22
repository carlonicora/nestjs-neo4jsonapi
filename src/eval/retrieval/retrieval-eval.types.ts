// src/eval/retrieval/retrieval-eval.types.ts
import { z } from "zod";

/** One question with its ground truth. Authored per repo, corrected by the owner. */
export const evalQuestionSchema = z.object({
  id: z.string().describe("Stable identifier, unique within the set"),
  corpus: z.string().describe("Which corpus this question is asked against, e.g. 'a360ai/P10'"),
  question: z.string().describe("The question exactly as a user would ask it"),
  mustRetrieve: z.array(z.string()).describe("Distinctive text snippets a correct answer must be grounded in"),
  rubric: z.string().describe("What a correct answer must assert, in one or two sentences"),
  scopeId: z.string().optional().describe("Scope root id when the turn is scope-confined"),
  scopeType: z.string().optional().describe("JSON:API type of the scope root"),
  scopeLabel: z
    .string()
    .optional()
    .describe(
      "Neo4j label of the scope root, e.g. 'Campaign'. Required whenever scopeId is set: the scope guard needs the label, and deriving it would pull the graph catalog into the runner.",
    ),
});
export type EvalQuestion = z.infer<typeof evalQuestionSchema>;

export const evalQuestionSetSchema = z.object({
  version: z.literal(1),
  product: z.string().describe("Which product this set belongs to, e.g. 'a360ai'"),
  questions: z.array(evalQuestionSchema).min(1),
});
export type EvalQuestionSet = z.infer<typeof evalQuestionSetSchema>;

/** Why a question failed its rubric. Closed set — see spec §6.5. */
export type RubricFailureMode =
  "evidence-not-retrieved" | "retrieved-but-unused" | "contradicted-source" | "hedged-without-answering";

export interface RubricVerdict {
  passed: boolean;
  failureMode?: RubricFailureMode;
  explanation: string;
}

/** One question's result in retrieval-only mode. */
export interface RetrievalSweepResult {
  questionId: string;
  evidenceRetrieved: number;
  missingSnippets: string[];
  chunksRead: number;
  retrievalMs: number;
  error?: string;
}

/** One question's result in end-to-end mode. Extends the retrieval facts with answer facts. */
export interface EndToEndSweepResult extends RetrievalSweepResult {
  evidenceCited: number;
  uncitedSnippets: string[];
  verdict: RubricVerdict;
  inputTokens: number;
  outputTokens: number;
  answerMs: number;
  tokenAccounting: TokenAccountingCheck;
  /** Snippets found in the entries the answer model actually received (post-trim). */
  evidenceRead: number;
  /** Notebook entries that survived the trim; 0 when readObserved is false. */
  chunksKept: number;
  /** Kept entries that reached the model in core (unwidened) form; 0 when readObserved is false. */
  chunksKeptCore: number;
  /** False when the turn produced no keptChunkIds (failed turn / node skipped). */
  readObserved: boolean;
}

/** Spec §6.5 — the harness validates its own token accounting. */
export interface TokenAccountingCheck {
  ledgerInput: number;
  observedInput: number;
  ledgerOutput: number;
  observedOutput: number;
  agrees: boolean;
  /**
   * Whether the comparison actually ran. A question that never produced a turn
   * has nothing to compare — reporting `agrees: true` there would be the one
   * direction this mechanism must never fail (§6.5).
   */
  checked: boolean;
}

export interface SweepSummary<T extends RetrievalSweepResult> {
  product: string;
  mode: "retrieval-only" | "end-to-end";
  model: string;
  startedAt: string;
  results: T[];
}
