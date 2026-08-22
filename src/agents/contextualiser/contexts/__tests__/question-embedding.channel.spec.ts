import { describe, it, expect } from "vitest";
import { ContextualiserContext } from "../contextualiser.context";

/**
 * `Annotation.Root` compiles each channel into a LangGraph
 * `BinaryOperatorAggregate`, which stores the declared reducer as `.operator`
 * and the declared default as `.initialValueFactory` (there is no `.reducer`
 * or `.default` property at this LangGraph version — verified against
 * `ContextualiserContext.spec.questionEmbedding` at HEAD, matching the same
 * finding already documented for `ResponderContext.spec.tokens` in
 * `src/agents/responder/nodes/__tests__/responder.answer.tokens.spec.ts`).
 */
describe("questionEmbedding channel", () => {
  it("is declared with a last-write-wins reducer that never clears a set value", () => {
    const channel = (ContextualiserContext.spec as any).questionEmbedding;
    expect(channel).toBeDefined();

    const reducer = channel.operator as (
      current: number[] | undefined,
      update: number[] | undefined,
    ) => number[] | undefined;

    expect(reducer(undefined, [0.1, 0.2])).toEqual([0.1, 0.2]);
    expect(reducer([0.1, 0.2], undefined)).toEqual([0.1, 0.2]);
    expect(reducer([0.1], [0.9])).toEqual([0.9]);
  });

  it("defaults to undefined", () => {
    const channel = (ContextualiserContext.spec as any).questionEmbedding;
    expect(channel.initialValueFactory()).toBeUndefined();
  });
});
