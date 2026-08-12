import { describe, expect, it } from "vitest";
import { ContextualiserContextFactoryService } from "../contextualiser.context.factory";

/**
 * The second half of the SEEDING junction (Task 10). `ContextualiserService.run`
 * hands the caller's attribution to this factory; the factory is what turns it
 * into graph state the nodes can read. Deleting the five assignments here would
 * break billing in production, so they are pinned.
 */
describe("ContextualiserContextFactoryService — caller attribution", () => {
  const factory = new ContextualiserContextFactoryService();

  const create = (attribution?: Parameters<typeof factory.create>[0]["attribution"]) =>
    factory.create({
      companyId: "company-1",
      contentId: "content-1",
      contentType: "Document",
      dataLimits: {},
      previousMessages: [],
      attribution,
    });

  it("copies every attribution field onto the initial state", () => {
    const state = create({
      tokenUsageType: "responder",
      scopeId: "campaign-1",
      scopeType: "campaigns",
      scopeLabel: "Campaign",
      assistantId: "assistant-1",
    });

    expect(state).toMatchObject({
      tokenUsageType: "responder",
      scopeId: "campaign-1",
      scopeType: "campaigns",
      scopeLabel: "Campaign",
      assistantId: "assistant-1",
    });
  });

  it("leaves every attribution field undefined when the caller supplies none", () => {
    const state = create(undefined);

    expect(state.tokenUsageType).toBeUndefined();
    expect(state.scopeId).toBeUndefined();
    expect(state.scopeType).toBeUndefined();
    expect(state.scopeLabel).toBeUndefined();
    expect(state.assistantId).toBeUndefined();
  });

  it("copies a partial attribution without inventing the missing halves", () => {
    // The caller knows only the thread: the scope fields must stay empty rather
    // than be filled from contentId/contentType, which is a different entity.
    const state = create({ tokenUsageType: "operator", assistantId: "assistant-1" });

    expect(state.assistantId).toBe("assistant-1");
    expect(state.scopeId).toBeUndefined();
    expect(state.scopeLabel).toBeUndefined();
  });

  it("still builds the rest of the state exactly as before", () => {
    const state = create(undefined);

    expect(state).toMatchObject({
      companyId: "company-1",
      contentId: "content-1",
      contentType: "Document",
      hops: 0,
      nextStep: "rational_plan",
      tokens: { input: 0, output: 0 },
    });
  });
});
