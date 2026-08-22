import { describe, expect, it } from "vitest";
import { ContextualiserContext } from "../../contexts/contextualiser.context";
import { MAX_LLM_CALLS_PER_RUN } from "../../../../foundations/chunk/repositories/retrieval.constants";

/**
 * `Annotation.Root` compiles each channel into a LangGraph
 * `BinaryOperatorAggregate`, which stores the declared reducer as `.operator`
 * and the declared default as `.initialValueFactory` (there is no `.reducer`
 * or `.default` property at this LangGraph version — the same finding already
 * documented for `ContextualiserContext.spec.questionEmbedding` in
 * `src/agents/contextualiser/contexts/__tests__/question-embedding.channel.spec.ts`
 * and for `ResponderContext.spec.tokens` in
 * `src/agents/responder/nodes/__tests__/responder.answer.tokens.spec.ts`).
 */
describe("llmCalls channel", () => {
  const channel = () => (ContextualiserContext.spec as any).llmCalls;

  it("is declared with an additive reducer", () => {
    const reducer = channel().operator as (current: number | undefined, update: number | undefined) => number;

    expect(reducer(0, 1)).toBe(1);
    expect(reducer(3, 20)).toBe(23);
    expect(reducer(5, undefined)).toBe(5);
  });

  it("defaults to zero", () => {
    expect(channel().initialValueFactory()).toBe(0);
  });
});

/**
 * Mirrors the budget branch of `returnState` in `contextualiser.service.ts`.
 * The routing decision is a pure function of the calls spent so far and the
 * next step the state asked for.
 */
const route = (llmCalls: number, nextStep: string): string => (llmCalls >= MAX_LLM_CALLS_PER_RUN ? "answer" : nextStep);

describe("contextualiser call-budget routing", () => {
  it("lets the requested step through while the budget has room", () => {
    expect(route(0, "key_concepts")).toBe("key_concepts");
    expect(route(MAX_LLM_CALLS_PER_RUN - 1, "chunks")).toBe("chunks");
  });

  it("routes to answer once the budget is spent, and stays there when overshot", () => {
    expect(route(MAX_LLM_CALLS_PER_RUN, "chunks")).toBe("answer");
    expect(route(MAX_LLM_CALLS_PER_RUN + 40, "chunks")).toBe("answer");
  });
});
