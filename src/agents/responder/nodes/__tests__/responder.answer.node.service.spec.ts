import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ResponderAnswerNodeService } from "../responder.answer.node.service";
import { LLMService } from "../../../../core/llm/services/llm.service";

interface LLMResponse {
  title: string;
  analyse: string;
  citations: { chunkId: string; relevance: number }[];
  references: { ref: string; relevance: number; reason: string }[];
  questions: string[];
  finalAnswer: string;
  tokenUsage: { input: number; output: number };
}

const baseLLMResponse: LLMResponse = {
  title: "Stub Title",
  analyse: "Stub analysis",
  citations: [],
  references: [],
  questions: ["q1", "q2"],
  finalAnswer: "Stub final answer",
  tokenUsage: { input: 100, output: 50 },
};

function makeLLMResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
  return { ...baseLLMResponse, ...overrides };
}

function buildState(partial: Record<string, any>): any {
  return {
    companyId: "co-1",
    contentId: undefined,
    contentType: undefined,
    dataLimits: undefined,
    context: undefined,
    driftContext: undefined,
    graphContext: undefined,
    tokens: { input: 0, output: 0 },
    finalAnswer: undefined,
    sources: undefined,
    references: undefined,
    ontologies: undefined,
    userId: "user-1",
    userModuleIds: [],
    rawQuestion: "what?",
    question: "what?",
    chatHistory: [],
    branchPlan: { runGraph: false, runContextualiser: false, runDrift: false, reasoning: "" },
    plannerError: null,
    graphError: null,
    contextualiserError: null,
    driftError: null,
    trace: {
      planner: {
        reasoning: "",
        branchPlan: { runGraph: false, runContextualiser: false, runDrift: false },
        tokens: { input: 0, output: 0 },
      },
      answer: { branchesUsed: [], tokens: { input: 0, output: 0 } },
      totalTokens: { input: 0, output: 0 },
    },
    ...partial,
  };
}

const sampleContext = {
  question: "What is X?",
  annotations: "Some annotations",
  notebook: [
    { chunkId: "chunk-1", content: "X is a thing", reason: "definition" },
    { chunkId: "chunk-2", content: "X has properties", reason: "details" },
  ],
  ontology: ["concept-X", "concept-Y"],
};

const sampleGraphContext = {
  answer: "Acme Corp has one open order: ORD-2026-0001.",
  entities: [
    {
      type: "accounts",
      id: "a-1",
      reason: "named in question",
      foundAtHop: 0,
      fields: { name: "Acme Corp", country_code: "GB" },
    },
    {
      type: "orders",
      id: "o-1",
      reason: "linked to account",
      foundAtHop: 1,
      fields: { number: "ORD-2026-0001", status: "open" },
    },
  ],
  toolCalls: [],
  tokens: { input: 30, output: 15 },
  status: "success" as const,
};

const sampleDriftContext = {
  answer: "drift answer",
  matchedCommunities: [
    { name: "Sales Community", summary: "Summary about sales" } as any,
    { name: "Support Community", summary: "Support summary" } as any,
  ],
  followUpAnswers: [{ question: "How?", answer: "Like this" }],
  initialAnswer: "Initial drift analysis",
  confidence: 75,
  hydeEmbedding: [],
};

describe("ResponderAnswerNodeService.execute", () => {
  let service: ResponderAnswerNodeService;
  const llm = { call: vi.fn() } as unknown as LLMService;
  const config = { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;

  beforeEach(async () => {
    vi.clearAllMocks();
    (config.get as unknown as Mock).mockReturnValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResponderAnswerNodeService,
        { provide: LLMService, useValue: llm },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(ResponderAnswerNodeService);
  });

  it("graph-only: graphSection uses [ref:N] handles + JSON fields; refs map back to (type,id)", async () => {
    (llm.call as unknown as Mock).mockResolvedValue(
      makeLLMResponse({
        references: [
          { ref: "ref:0", relevance: 90, reason: "primary entity" },
          { ref: "ref:1", relevance: 60, reason: "linked" },
        ],
      }),
    );

    const state = buildState({
      branchPlan: { runGraph: true, runContextualiser: false, runDrift: false, reasoning: "" },
      graphContext: sampleGraphContext,
    });

    const result = await service.execute({ state });

    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    // Synthesizer sees handles, not type/id pairs.
    expect(callArgs.inputParams.graphSection).toContain("[ref:0]");
    expect(callArgs.inputParams.graphSection).toContain("[ref:1]");
    expect(callArgs.inputParams.graphSection).not.toContain("accounts/a-1");
    expect(callArgs.inputParams.graphSection).not.toContain("orders/o-1");
    // Field values from each entity must surface so the synthesizer can quote them.
    expect(callArgs.inputParams.graphSection).toContain("Acme Corp");
    expect(callArgs.inputParams.graphSection).toContain("ORD-2026-0001");
    expect(callArgs.inputParams.graphSection).toContain('"status": "open"');
    expect(callArgs.inputParams.graphSection).toContain("--- GRAPH BRANCH ---");
    expect(callArgs.inputParams.graphSection).toContain("Acme Corp has one open order: ORD-2026-0001.");
    expect(callArgs.inputParams.graphSection).toContain("--- entities for citation ---");
    expect(callArgs.inputParams.notebookSection).toBe("");
    expect(callArgs.inputParams.driftSection).toBe("");
    expect(callArgs.inputParams.scopeSection).toBe("");
    expect(callArgs.inputParams.branchesUsed).toEqual(["graph"]);

    // Refs are remapped to real (type,id) for persistence.
    expect(result.references).toHaveLength(2);
    expect(result.references?.[0]).toMatchObject({ type: "accounts", id: "a-1", relevance: 90 });
    expect(result.references?.[1]).toMatchObject({ type: "orders", id: "o-1", relevance: 60 });
    expect(result.sources).toEqual([]);
    expect((result.trace as any).answer.branchesUsed).toEqual(["graph"]);
  });

  it("contextualiser-only: notebookSection has chunkId-prefixed lines, sources populated and deduplicated, references empty", async () => {
    (llm.call as unknown as Mock).mockResolvedValue(
      makeLLMResponse({
        citations: [
          { chunkId: "chunk-1", relevance: 70 },
          { chunkId: "chunk-1", relevance: 90 }, // duplicate, higher relevance
          { chunkId: "chunk-2", relevance: 60 },
        ],
      }),
    );

    const state = buildState({
      branchPlan: { runGraph: false, runContextualiser: true, runDrift: false, reasoning: "" },
      context: sampleContext,
    });

    const result = await service.execute({ state });

    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    expect(callArgs.inputParams.notebookSection).toContain("chunk-1: X is a thing");
    expect(callArgs.inputParams.notebookSection).toContain("chunk-2: X has properties");
    expect(callArgs.inputParams.notebookSection).toContain("Some annotations");
    expect(callArgs.inputParams.graphSection).toBe("");
    expect(callArgs.inputParams.driftSection).toBe("");
    expect(callArgs.inputParams.branchesUsed).toEqual(["contextualiser"]);

    expect(result.sources).toHaveLength(2);
    const chunk1 = result.sources!.find((s) => s.chunkId === "chunk-1")!;
    expect(chunk1.relevance).toBe(90); // dedup picks higher
    expect(chunk1.reason).toBe("definition");
    expect(result.references).toEqual([]);
    expect(result.ontologies).toEqual(["concept-X", "concept-Y"]);
  });

  it("drift-only: driftSection contains community names, other sections empty", async () => {
    (llm.call as unknown as Mock).mockResolvedValue(makeLLMResponse());

    const state = buildState({
      branchPlan: { runGraph: false, runContextualiser: false, runDrift: true, reasoning: "" },
      driftContext: sampleDriftContext,
    });

    const result = await service.execute({ state });

    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    expect(callArgs.inputParams.driftSection).toContain("Sales Community");
    expect(callArgs.inputParams.driftSection).toContain("Support Community");
    expect(callArgs.inputParams.driftSection).toContain("Initial analysis: Initial drift analysis");
    expect(callArgs.inputParams.driftSection).toContain("Drift confidence: 75%");
    expect(callArgs.inputParams.notebookSection).toBe("");
    expect(callArgs.inputParams.graphSection).toBe("");
    expect(callArgs.inputParams.branchesUsed).toEqual(["drift"]);

    expect(result.sources).toEqual([]);
    expect(result.references).toEqual([]);
  });

  it("graph+contextualiser: both sections present, drift empty", async () => {
    (llm.call as unknown as Mock).mockResolvedValue(
      makeLLMResponse({
        citations: [{ chunkId: "chunk-1", relevance: 80 }],
        references: [{ ref: "ref:0", relevance: 85, reason: "found" }],
      }),
    );

    const state = buildState({
      branchPlan: { runGraph: true, runContextualiser: true, runDrift: false, reasoning: "" },
      context: sampleContext,
      graphContext: sampleGraphContext,
    });

    const result = await service.execute({ state });

    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    expect(callArgs.inputParams.graphSection).toContain("[ref:0]");
    expect(callArgs.inputParams.notebookSection).toContain("chunk-1");
    expect(callArgs.inputParams.driftSection).toBe("");
    expect(callArgs.inputParams.branchesUsed).toEqual(["graph", "contextualiser"]);

    expect(result.sources).toHaveLength(1);
    expect(result.references).toHaveLength(1);
    expect(result.references?.[0]).toMatchObject({ type: "accounts", id: "a-1" });
  });

  it("graph+drift: both sections present, notebook empty", async () => {
    (llm.call as unknown as Mock).mockResolvedValue(
      makeLLMResponse({
        references: [{ ref: "ref:0", relevance: 70, reason: "context" }],
      }),
    );

    const state = buildState({
      branchPlan: { runGraph: true, runContextualiser: false, runDrift: true, reasoning: "" },
      graphContext: sampleGraphContext,
      driftContext: sampleDriftContext,
    });

    const result = await service.execute({ state });

    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    expect(callArgs.inputParams.graphSection).toContain("[ref:0]");
    expect(callArgs.inputParams.driftSection).toContain("Sales Community");
    expect(callArgs.inputParams.notebookSection).toBe("");
    expect(callArgs.inputParams.branchesUsed).toEqual(["graph", "drift"]);
    expect(result.references).toHaveLength(1);
    expect(result.references?.[0]).toMatchObject({ type: "accounts", id: "a-1" });
  });

  it("contextualiser+drift: both sections present, graph empty", async () => {
    (llm.call as unknown as Mock).mockResolvedValue(
      makeLLMResponse({
        citations: [{ chunkId: "chunk-2", relevance: 65 }],
      }),
    );

    const state = buildState({
      branchPlan: { runGraph: false, runContextualiser: true, runDrift: true, reasoning: "" },
      context: sampleContext,
      driftContext: sampleDriftContext,
    });

    const result = await service.execute({ state });

    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    expect(callArgs.inputParams.notebookSection).toContain("chunk-2");
    expect(callArgs.inputParams.driftSection).toContain("Sales Community");
    expect(callArgs.inputParams.graphSection).toBe("");
    expect(callArgs.inputParams.branchesUsed).toEqual(["contextualiser", "drift"]);

    expect(result.sources).toHaveLength(1);
    expect(result.references).toEqual([]);
  });

  it("all-three: all three sections present, references and sources populated", async () => {
    (llm.call as unknown as Mock).mockResolvedValue(
      makeLLMResponse({
        citations: [{ chunkId: "chunk-1", relevance: 85 }],
        references: [{ ref: "ref:1", relevance: 75, reason: "central" }],
        tokenUsage: { input: 200, output: 80 },
      }),
    );

    const state = buildState({
      branchPlan: { runGraph: true, runContextualiser: true, runDrift: true, reasoning: "" },
      context: sampleContext,
      graphContext: sampleGraphContext,
      driftContext: sampleDriftContext,
      tokens: { input: 50, output: 25 }, // pre-existing tokens, e.g. from graph branch
    });

    const result = await service.execute({ state });

    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    expect(callArgs.inputParams.notebookSection).toContain("chunk-1");
    expect(callArgs.inputParams.graphSection).toContain("[ref:1]");
    expect(callArgs.inputParams.driftSection).toContain("Sales Community");
    expect(callArgs.inputParams.branchesUsed).toEqual(["graph", "contextualiser", "drift"]);

    expect(result.sources).toHaveLength(1);
    expect(result.references).toHaveLength(1);
    expect(result.references?.[0]).toMatchObject({ type: "orders", id: "o-1" });

    // Tokens accumulate
    expect(result.tokens).toEqual({ input: 250, output: 105 });
    expect((result.trace as any).answer.tokens).toEqual({ input: 200, output: 80 });
    expect((result.trace as any).answer.branchesUsed).toEqual(["graph", "contextualiser", "drift"]);
  });

  it("empty corpus: branches enabled but contexts undefined, hasAnswer derived from branchesUsed.length>0", async () => {
    (llm.call as unknown as Mock).mockResolvedValue(makeLLMResponse());

    const state = buildState({
      branchPlan: { runGraph: true, runContextualiser: true, runDrift: true, reasoning: "" },
      context: undefined,
      graphContext: undefined,
      driftContext: undefined,
    });

    const result = await service.execute({ state });

    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    expect(callArgs.inputParams.notebookSection).toBe("");
    expect(callArgs.inputParams.graphSection).toBe("");
    expect(callArgs.inputParams.driftSection).toBe("");
    expect(callArgs.inputParams.branchesUsed).toEqual(["graph", "contextualiser", "drift"]);

    expect(result.finalAnswer?.hasAnswer).toBe(true); // because branchesUsed.length > 0
    expect(result.sources).toEqual([]);
    expect(result.references).toEqual([]);
  });

  it("hallucinated ref handles are filtered: refs not in the synthesizer's refMap are dropped", async () => {
    (llm.call as unknown as Mock).mockResolvedValue(
      makeLLMResponse({
        references: [
          { ref: "ref:0", relevance: 90, reason: "real" },
          { ref: "ref:99", relevance: 70, reason: "out of range — invented" },
          { ref: "not-a-ref", relevance: 60, reason: "also invented" },
        ],
      }),
    );

    const state = buildState({
      branchPlan: { runGraph: true, runContextualiser: false, runDrift: false, reasoning: "" },
      graphContext: {
        answer: "",
        entities: [{ type: "accounts", id: "a-1", reason: "real entity", foundAtHop: 0 }],
        toolCalls: [],
        tokens: { input: 0, output: 0 },
        status: "success" as const,
      },
    });

    const result = await service.execute({ state });

    expect(result.references).toHaveLength(1);
    expect(result.references![0]).toMatchObject({ type: "accounts", id: "a-1", relevance: 90 });
  });

  it("scope section: contentId/contentType set produces scopeSection with type:id token", async () => {
    (llm.call as unknown as Mock).mockResolvedValue(makeLLMResponse());

    const state = buildState({
      branchPlan: { runGraph: false, runContextualiser: false, runDrift: false, reasoning: "" },
      contentId: "abc-123",
      contentType: "projects",
    });

    await service.execute({ state });

    const callArgs = (llm.call as unknown as Mock).mock.calls[0][0];
    expect(callArgs.inputParams.scopeSection).toContain("projects:abc-123");
    expect(callArgs.inputParams.scopeSection).toContain("CONVERSATION SCOPE");
    expect(callArgs.inputParams.branchesUsed).toEqual([]);
  });
});
