import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PlannerNodeService } from "../planner.node.service";
import { LLMService } from "../../../../core/llm/services/llm.service";
import { GraphCatalogService } from "../../../graph/services/graph.catalog.service";

/**
 * Every responder node that SPENDS tokens must return them into the additive
 * `tokens` channel, not only into `trace`.
 *
 * The planner, graph and drift nodes each reported their usage in
 * `trace.<node>.tokens` and returned no `tokens` key at all, so the accumulated
 * channel — which is what reaches `response.tokens`, the user-facing total —
 * only ever held the contextualiser's and the answer node's spend. The eval
 * harness's §6.5 self-check caught it on its first real sweep: all 20 questions
 * reported observed-minus-ledger of ~497 input / ~213 output, exactly one
 * planner call.
 *
 * This is the mirror of the `2C + A` double-count fixed in Phase 0: there a node
 * returned the accumulated total into an additive channel; here nodes returned
 * nothing at all. Both make `response.tokens` wrong.
 */
describe("responder nodes feed the additive tokens channel", () => {
  const llm = { call: vi.fn() } as unknown as LLMService;
  const catalog = {
    getTypeIndexFor: vi.fn().mockReturnValue("- accounts — A customer."),
  } as unknown as GraphCatalogService;
  const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;

  let planner: PlannerNodeService;

  const baseState = {
    rawQuestion: "q",
    userModuleIds: [],
    chatHistory: [],
    seedContexts: [],
  } as never;

  beforeEach(async () => {
    vi.clearAllMocks();
    (catalog.getTypeIndexFor as unknown as Mock).mockReturnValue("- accounts — A customer.");
    (config.get as unknown as Mock).mockReturnValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlannerNodeService,
        { provide: LLMService, useValue: llm },
        { provide: GraphCatalogService, useValue: catalog },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    planner = moduleRef.get(PlannerNodeService);
  });

  it("planner returns its own spend in `tokens`, matching what it reports in the trace", async () => {
    (llm.call as unknown as Mock).mockResolvedValue({
      runGraph: false,
      runContextualiser: true,
      runDrift: false,
      reasoning: "documents",
      refinedQuestion: "q refined",
      tokenUsage: { input: 497, output: 213 },
    });

    const result = await planner.execute({ state: baseState });

    expect(result.tokens).toEqual({ input: 497, output: 213 });
    // The trace and the channel must never disagree — that disagreement IS the bug.
    expect((result.trace as unknown as { planner: { tokens: unknown } }).planner.tokens).toEqual(result.tokens);
  });

  it("planner contributes nothing to the channel when its call fails", async () => {
    (llm.call as unknown as Mock).mockRejectedValue(new Error("provider down"));

    const result = await planner.execute({ state: baseState });

    expect(result.plannerError).toContain("provider down");
    expect(result.tokens).toEqual({ input: 0, output: 0 });
  });
});
