import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { LLMService } from "../../core/llm/services/llm.service";
import { RubricFailureMode, RubricVerdict } from "./retrieval-eval.types";

export const RUBRIC_JUDGE_PROMPT = `
You are grading one answer produced by a retrieval-augmented assistant.

You are given the user's question, a rubric stating what a correct answer MUST
assert, the answer that was produced, and how many pieces of required evidence
the answer cited.

Decide ONE thing: does the answer satisfy the rubric?

Judge only against the rubric. Do not reward length, tone, formatting or
confidence. An answer that is well written but does not assert what the rubric
requires has failed. An answer that asserts what the rubric requires in plain
language has passed, even if it is terse.

When the answer FAILS, classify why, choosing exactly one:

- evidence-not-retrieved: the answer could not have been written because the
  required material never reached it. Typically the citation count is zero.
- retrieved-but-unused: the required material was cited or is clearly present,
  and the answer still does not assert what the rubric requires.
- contradicted-source: the answer asserts something that conflicts with the
  material it cites.
- hedged-without-answering: the answer declines, defers, or describes what it
  would need, instead of answering.

Be strict and be consistent. Your explanation must be one sentence naming the
specific rubric requirement that was met or missed.
`;

/**
 * The closed set of failure modes (spec §6.5). Declared once so the schema the
 * model is constrained to and the runtime guard below can never drift apart.
 */
const FAILURE_MODES = [
  "evidence-not-retrieved",
  "retrieved-but-unused",
  "contradicted-source",
  "hedged-without-answering",
] as const;

const outputSchema = z.object({
  passed: z.boolean().describe("True only if the answer asserts everything the rubric requires"),
  failureMode: z
    .enum(FAILURE_MODES)
    .optional()
    .describe("Present if and only if passed is false. One of the four named modes, verbatim."),
  explanation: z.string().describe("One sentence naming the specific rubric requirement that was met or missed"),
});

const inputSchema = z.object({
  question: z.string().describe("The user's question, verbatim"),
  rubric: z
    .string()
    .describe("BINDING CRITERION. What a correct answer must assert. Judge against this and nothing else."),
  answer: z.string().describe("The answer under test. Grade it; do not improve or continue it."),
  evidenceCited: z
    .number()
    .describe("How many required evidence snippets the answer cited. Zero suggests evidence-not-retrieved."),
});

const isFailureMode = (value: unknown): value is RubricFailureMode =>
  typeof value === "string" && (FAILURE_MODES as readonly string[]).includes(value);

/**
 * Grades one answer against its rubric.
 *
 * A judging failure degrades to a FAILED verdict for that question rather than
 * killing the sweep — the graceful-degradation rule in 06-llm-calls.md rule 8,
 * applied deliberately: an ungraded question must never silently count as a pass.
 *
 * ATTRIBUTION EXCEPTION (06-llm-calls.md rule 5). `tokenUsageType` and
 * `metadata` are set, but `relationshipId` / `relationshipType` are deliberately
 * absent: a sweep grades the harness itself, so there is no tenant entity whose
 * spend this is. LLMService skips usage persistence unless BOTH are set, which
 * is the intended outcome here — eval spend must not land on a customer's
 * ledger. The call is still fully identifiable in dumps and telemetry through
 * metadata.agentName / metadata.nodeName.
 */
@Injectable()
export class RubricJudgeService {
  private readonly logger = new Logger(RubricJudgeService.name);

  constructor(private readonly llmService: LLMService) {}

  async judge(params: {
    question: string;
    rubric: string;
    answer: string;
    evidenceCited: number;
  }): Promise<RubricVerdict> {
    try {
      const response = await this.llmService.call<z.infer<typeof outputSchema>>({
        inputSchema,
        inputParams: {
          question: params.question,
          rubric: params.rubric,
          answer: params.answer,
          evidenceCited: params.evidenceCited,
        },
        outputSchema,
        systemPrompts: [RUBRIC_JUDGE_PROMPT],
        // A grading pass is judgement, not creation: no sampling variance, so
        // the same answer is graded the same way on every run.
        temperature: 0,
        // Deliberate for THIS call (06-llm-calls.md rule 6 / checkpoint step 5):
        // stated here rather than inherited from the tier, so a deployment that
        // retunes the default cannot silently change how the baseline is graded.
        // "low" matches the model this baseline is measured on (gpt-5.6-luna).
        reasoningEffort: "low",
        tokenUsageType: "retrieval_eval",
        metadata: { agentName: "retrieval-eval", nodeName: "rubric-judge" },
      });

      // The schema already constrains the model; this guard keeps the returned
      // union honest even when the provider falls back to lenient parsing.
      const failureMode = isFailureMode(response.failureMode) ? response.failureMode : undefined;

      return {
        passed: response.passed,
        ...(failureMode ? { failureMode } : {}),
        explanation: response.explanation,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`rubric judge failed, recording the question as failed: ${message}`);
      return { passed: false, explanation: `Judge unavailable: ${message}` };
    }
  }
}
