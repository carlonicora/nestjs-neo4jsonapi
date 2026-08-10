import { describe, expect, it, vi } from "vitest";
import { PlannerNodeService } from "../planner.node.service";

describe("PlannerNodeService seed titles", () => {
  it("passes the seed context titles to the planner LLM", async () => {
    const call = vi.fn(async () => ({
      runGraph: true,
      runContextualiser: false,
      runDrift: false,
      reasoning: "r",
      refinedQuestion: "q",
      tokenUsage: { input: 0, output: 0 },
    }));
    const catalog = { getTypeIndexFor: vi.fn(() => "catalog") } as any;
    const config = { get: vi.fn(() => undefined) } as any;
    const service = new PlannerNodeService({ call } as any, catalog, config);

    await service.execute({
      state: {
        rawQuestion: "q",
        chatHistory: [],
        userModuleIds: [],
        seedContexts: [{ title: "CAMPAIGN TIMELINE — KEY EVENTS", content: "x" }],
      } as any,
    });

    expect((call.mock.calls[0][0] as any).inputParams.seedTitles).toEqual(["CAMPAIGN TIMELINE — KEY EVENTS"]);
  });
});
