import { describe, it, expect } from "vitest";
import { ResponderContext } from "../../contexts/responder.context";

/**
 * `Annotation.Root` compiles each channel into a LangGraph
 * `BinaryOperatorAggregate`, which stores the declared reducer as `.operator`
 * (there is no `.reducer` property at this LangGraph version — verified
 * against `ResponderContext.spec.tokens` at HEAD). Reading `.operator` is
 * therefore how the declared arithmetic is pinned here.
 */
function tokensReducer(): (
  current: { input: number; output: number } | undefined,
  update: { input: number; output: number } | undefined,
) => { input: number; output: number } {
  return (ResponderContext.spec as any).tokens.operator;
}

describe("responder token accounting", () => {
  it("does not double-count when a node returns accumulated tokens", () => {
    const reducer = tokensReducer();

    const contextualiser = { input: 52618, output: 10809 };
    const answer = { input: 8296, output: 2650 };

    // What the answer node MUST return: its own delta.
    const afterDelta = reducer(contextualiser, answer);
    expect(afterDelta.input).toBe(60914);
    expect(afterDelta.output).toBe(13459);

    // What the buggy node returned: the accumulated total. Documents the defect.
    const accumulated = {
      input: contextualiser.input + answer.input,
      output: contextualiser.output + answer.output,
    };
    const afterAccumulated = reducer(contextualiser, accumulated);
    expect(afterAccumulated.input).toBe(113532); // 2C + A — the archived ledger figure
    expect(afterAccumulated.input).not.toBe(afterDelta.input);
  });
});

describe("ResponderAnswerNodeService return contract", () => {
  it("returns only the answer call's own token usage", async () => {
    // Arrange a node whose state already carries the contextualiser's spend.
    const { buildAnswerNodeUnderTest } = await import("./helpers/answer-node.harness");
    const node = buildAnswerNodeUnderTest({
      llmTokenUsage: { input: 8296, output: 2650 },
    });

    const result = await node.execute({
      state: {
        ...node.baseState,
        tokens: { input: 52618, output: 10809 },
      } as any,
    });

    expect(result.tokens).toEqual({ input: 8296, output: 2650 });
  });

  it("still reports the run total on the trace", async () => {
    const { buildAnswerNodeUnderTest } = await import("./helpers/answer-node.harness");
    const node = buildAnswerNodeUnderTest({
      llmTokenUsage: { input: 8296, output: 2650 },
    });

    const result = await node.execute({
      state: {
        ...node.baseState,
        tokens: { input: 52618, output: 10809 },
      } as any,
    });

    expect((result.trace as any).answer.tokens).toEqual({ input: 8296, output: 2650 });
    expect((result.trace as any).totalTokens).toEqual({ input: 60914, output: 13459 });
  });
});
