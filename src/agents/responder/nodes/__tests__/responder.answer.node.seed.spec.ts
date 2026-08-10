import { describe, expect, it, vi } from "vitest";
import { ResponderAnswerNodeService } from "../responder.answer.node.service";

const llmResult = (references: Array<{ ref: string; relevance: number; reason: string }>) => ({
  title: "t",
  analyse: "a",
  citations: [],
  references,
  questions: [],
  finalAnswer: "answer",
  tokenUsage: { input: 1, output: 2 },
});

const buildState = (overrides: Record<string, unknown> = {}) =>
  ({
    question: "what happened so far?",
    rawQuestion: "what happened so far?",
    branchPlan: undefined,
    graphContext: undefined,
    context: undefined,
    driftContext: undefined,
    contentId: undefined,
    contentType: undefined,
    seedContexts: [
      {
        title: "CAMPAIGN TIMELINE — KEY EVENTS",
        content: "- [2026-01-01] The heist — the crew robbed the vault",
        references: [{ type: "events", id: "evt-1", reason: "key event on the campaign timeline" }],
      },
    ],
    tokens: undefined,
    trace: {},
    ...overrides,
  }) as any;

describe("ResponderAnswerNodeService seed contexts", () => {
  const config = { get: vi.fn(() => undefined) } as any;

  it("renders seedSection with citable handles and remaps seed references", async () => {
    const call = vi.fn(async () => llmResult([{ ref: "ref:0", relevance: 90, reason: "grounded" }]));
    const service = new ResponderAnswerNodeService({ call } as any, config);

    const state = await service.execute({ state: buildState() });

    const inputParams = (call.mock.calls[0][0] as any).inputParams;
    expect(inputParams.seedSection).toContain("--- CAMPAIGN TIMELINE — KEY EVENTS ---");
    expect(inputParams.seedSection).toContain("- [2026-01-01] The heist — the crew robbed the vault");
    expect(inputParams.seedSection).toContain("[ref:0] events — key event on the campaign timeline");
    expect(state.references).toEqual([{ type: "events", id: "evt-1", relevance: 90, reason: "grounded" }]);
    expect(state.finalAnswer?.hasAnswer).toBe(true);
  });

  it("dedupes a seed reference already present as a graph entity — the graph handle wins", async () => {
    const call = vi.fn(async () => llmResult([]));
    const service = new ResponderAnswerNodeService({ call } as any, config);

    const state = buildState({
      branchPlan: { runGraph: true, runContextualiser: false, runDrift: false, reasoning: "" },
      graphContext: {
        answer: "graph prose",
        entities: [{ type: "events", id: "evt-1", reason: "loaded by graph", fields: {} }],
        toolCalls: [],
      },
    });
    await service.execute({ state });

    const inputParams = (call.mock.calls[0][0] as any).inputParams;
    // The duplicate seed reference must NOT mint a second handle for evt-1.
    expect(inputParams.seedSection).not.toContain("ref:1");
    expect(inputParams.graphSection).toContain("[ref:0] events — loaded by graph");
  });

  it("emits an empty seedSection and unchanged hasAnswer when no seeds exist", async () => {
    const call = vi.fn(async () => llmResult([]));
    const service = new ResponderAnswerNodeService({ call } as any, config);

    const state = await service.execute({ state: buildState({ seedContexts: undefined }) });

    expect((call.mock.calls[0][0] as any).inputParams.seedSection).toBe("");
    expect(state.finalAnswer?.hasAnswer).toBe(false);
  });
});
