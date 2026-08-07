import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PlannerNodeService, defaultPlannerPrompt } from "../planner.node.service";
import { LLMService } from "../../../../core/llm/services/llm.service";
import { GraphCatalogService } from "../../../graph/services/graph.catalog.service";

describe("PlannerNodeService", () => {
  const llm = { call: vi.fn() } as unknown as LLMService;
  const catalog = {
    getTypeIndexFor: vi.fn().mockReturnValue("- accounts — A customer."),
  } as unknown as GraphCatalogService;
  const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;

  let service: PlannerNodeService;

  async function build(): Promise<PlannerNodeService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlannerNodeService,
        { provide: LLMService, useValue: llm },
        { provide: GraphCatalogService, useValue: catalog },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    return moduleRef.get(PlannerNodeService);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    (catalog.getTypeIndexFor as unknown as Mock).mockReturnValue("- accounts — A customer.");
    (config.get as unknown as Mock).mockReturnValue(undefined);
    service = await build();
  });

  it("returns the structured plan and refined question on success", async () => {
    (llm.call as unknown as Mock).mockResolvedValue({
      runGraph: true,
      runContextualiser: false,
      runDrift: false,
      reasoning: "user named an Account",
      refinedQuestion: "What are Acme's open orders?",
      tokenUsage: { input: 50, output: 20 },
    });

    const out = await service.execute({
      state: {
        userModuleIds: ["crm"],
        chatHistory: [{ role: "user", content: "What about Acme's orders?" }],
        rawQuestion: "What about Acme's orders?",
        contentId: undefined,
        contentType: undefined,
      } as any,
    });

    expect(out.branchPlan).toEqual({
      runGraph: true,
      runContextualiser: false,
      runDrift: false,
      reasoning: "user named an Account",
    });
    expect(out.question).toBe("What are Acme's open orders?");
    expect(out.trace?.planner.tokens).toEqual({ input: 50, output: 20 });
    expect(out.plannerError).toBeNull();
  });

  it("falls back to runGraph+runContextualiser on LLM error", async () => {
    (llm.call as unknown as Mock).mockRejectedValue(new Error("LLM 500"));

    const out = await service.execute({
      state: {
        userModuleIds: ["crm"],
        chatHistory: [],
        rawQuestion: "Hello",
        contentId: undefined,
        contentType: undefined,
      } as any,
    });

    expect(out.branchPlan).toEqual({
      runGraph: true,
      runContextualiser: true,
      runDrift: false,
      reasoning: "planner_fallback",
    });
    expect(out.question).toBe("Hello");
    expect(out.plannerError).toContain("LLM 500");
  });

  it("includes content scope in the prompt when contentId/contentType are present", async () => {
    (llm.call as unknown as Mock).mockResolvedValue({
      runGraph: false,
      runContextualiser: true,
      runDrift: false,
      reasoning: "doc-shaped question scoped to a known content",
      refinedQuestion: "What does the brief say?",
      tokenUsage: { input: 30, output: 10 },
    });

    await service.execute({
      state: {
        userModuleIds: ["crm"],
        chatHistory: [],
        rawQuestion: "What does the brief say?",
        contentId: "abc-123",
        contentType: "projects",
      } as any,
    });

    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    const promptBlob = JSON.stringify(callArgs);
    expect(promptBlob).toContain("projects");
    expect(promptBlob).toContain("abc-123");
  });

  describe("prompt slot", () => {
    it("uses the default planner prompt when config supplies none", async () => {
      (llm.call as unknown as Mock).mockResolvedValue({
        runGraph: true,
        runContextualiser: false,
        runDrift: false,
        reasoning: "r",
        refinedQuestion: "q",
      });

      await service.execute({ state: { userModuleIds: [], chatHistory: [], rawQuestion: "q" } as any });

      const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
      expect(callArgs.systemPrompts).toEqual([defaultPlannerPrompt]);
    });

    it("prefers prompts.planner from config when set", async () => {
      (config.get as unknown as Mock).mockReturnValue({ planner: "CUSTOM PLANNER PROMPT" });
      const configured = await build();

      (llm.call as unknown as Mock).mockResolvedValue({
        runGraph: true,
        runContextualiser: false,
        runDrift: false,
        reasoning: "r",
        refinedQuestion: "q",
      });

      await configured.execute({ state: { userModuleIds: [], chatHistory: [], rawQuestion: "q" } as any });

      const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
      expect(callArgs.systemPrompts).toEqual(["CUSTOM PLANNER PROMPT"]);
    });
  });

  describe("defaultPlannerPrompt", () => {
    it("forbids paraphrasing proper-noun-looking spans in refinedQuestion", () => {
      expect(defaultPlannerPrompt).toMatch(/proper-noun-looking span/i);
      expect(defaultPlannerPrompt).toMatch(/verbatim/i);
      expect(defaultPlannerPrompt).toMatch(/Do not change "and" to "or"/i);
    });

    it("explains why paraphrasing breaks the lookup", () => {
      expect(defaultPlannerPrompt).toMatch(/uses `?refinedQuestion`? as the user's literal phrase/i);
    });
  });
});
