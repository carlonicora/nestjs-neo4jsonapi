import { vi } from "vitest";
import { ResponderAnswerNodeService } from "../../responder.answer.node.service";

/**
 * Builds a `ResponderAnswerNodeService` with its two real constructor
 * dependencies stubbed (see the constructor at
 * `responder.answer.node.service.ts` — `LLMService` then
 * `ConfigService<BaseConfigInterface>`), plus a minimal responder state the
 * node can execute against.
 */
export function buildAnswerNodeUnderTest(params: { llmTokenUsage: { input: number; output: number } }) {
  const llmService = {
    call: vi.fn().mockResolvedValue({
      title: "t",
      analyse: "a",
      finalAnswer: "f",
      citations: [],
      references: [],
      questions: [],
      tokenUsage: params.llmTokenUsage,
    }),
  };
  const configService = { get: vi.fn().mockReturnValue(undefined) };
  const node = new ResponderAnswerNodeService(llmService as any, configService as any);
  const baseState = {
    question: "q",
    branchPlan: { runGraph: false, runContextualiser: false, runDrift: false, reasoning: "" },
    seedContexts: [],
    trace: { planner: {}, answer: {}, totalTokens: { input: 0, output: 0 } },
    tokens: { input: 0, output: 0 },
  };
  return Object.assign(node, { baseState });
}
