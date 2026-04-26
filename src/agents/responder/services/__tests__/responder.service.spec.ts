import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { Test } from "@nestjs/testing";
import { ResponderService } from "../responder.service";
import { ResponderContextFactoryService } from "../../factories/responder.context.factory";
import { ContextualiserContextFactoryService } from "../../../contextualiser/factories/contextualiser.context.factory";
import { ContextualiserService } from "../../../contextualiser/services/contextualiser.service";
import { DriftSearchService } from "../../../drift/services/drift.search.service";
import { ResponderAnswerNodeService } from "../../nodes/responder.answer.node.service";
import { PlannerNodeService } from "../../nodes/planner.node.service";
import { GraphNodeService } from "../../nodes/graph.node.service";
import { AgentMessageType } from "../../../../common/enums/agentmessage.type";

const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  contentId: "770e8400-e29b-41d4-a716-446655440002",
};

const MOCK_MESSAGES = [{ type: AgentMessageType.User, content: "What is the latest order for Acme?" }];
const MOCK_DATA_LIMITS = {
  chunks: { total: 100, perContent: 50 },
  communities: { total: 50, perLevel: 10 },
} as any;

function plannerOutput(
  overrides: Partial<{ runGraph: boolean; runContextualiser: boolean; runDrift: boolean; reasoning: string }> = {},
) {
  const branchPlan = {
    runGraph: true,
    runContextualiser: true,
    runDrift: false,
    reasoning: "default",
    ...overrides,
  };
  return {
    branchPlan,
    question: "What is the latest order for Acme?",
    plannerError: null,
    trace: {
      planner: { reasoning: branchPlan.reasoning, branchPlan, tokens: { input: 10, output: 5 } },
      totalTokens: { input: 10, output: 5 },
    } as any,
  };
}

function graphSuccessReturn() {
  return {
    graphContext: {
      entities: [],
      toolCalls: [],
      tokens: { input: 0, output: 0 },
      status: "success" as const,
    },
    graphError: null,
    trace: {
      graph: {
        toolCalls: [],
        entitiesDiscovered: 0,
        status: "success" as const,
        tokens: { input: 0, output: 0 },
      },
    } as any,
  };
}

function graphFailedReturn(message = "tool fault") {
  return {
    graphContext: {
      entities: [],
      toolCalls: [],
      tokens: { input: 0, output: 0 },
      status: "failed" as const,
      errorMessage: message,
    },
    graphError: message,
    trace: {
      graph: {
        toolCalls: [],
        entitiesDiscovered: 0,
        status: "failed" as const,
        errorMessage: message,
        tokens: { input: 0, output: 0 },
      },
    } as any,
  };
}

function contextualiserSuccessReturn() {
  return {
    companyId: TEST_IDS.companyId,
    contentId: TEST_IDS.contentId,
    contentType: "Document",
    hops: 2,
    previousAnalysis: "",
    previousAnswer: "",
    limits: MOCK_DATA_LIMITS,
    prompts: { initial: "", answer: "" },
    chatHistory: [],
    question: "What is the latest order for Acme?",
    rationalPlan: "",
    annotations: "",
    notebook: [],
    chunkLevel: 0,
    queuedChunks: [],
    queuedKeyConcepts: [],
    processedChunks: ["c1"],
    processedKeyConcepts: [],
    processedAtomicFacts: [],
    processedNeighbours: [],
    neighbouringAlreadyExplored: false,
    sources: [],
    ontology: [],
    requests: [],
    nextStep: "answer",
    status: [],
    tokens: { input: 50, output: 25 },
  } as any;
}

function driftSuccessReturn() {
  return {
    answer: "",
    matchedCommunities: [],
    followUpAnswers: [],
    initialAnswer: "",
    confidence: 80,
    hydeEmbedding: [],
    tokens: { input: 30, output: 15 },
  } as any;
}

function answerNodeMock() {
  return {
    execute: vi.fn().mockImplementation(async ({ state }) => {
      // Mirror real answer node: mutate-and-return state, accumulate tokens, set finalAnswer/trace.
      state.sources = [];
      state.references = [];
      state.ontologies = [];
      state.tokens = {
        input: (state.tokens?.input ?? 0) + 100,
        output: (state.tokens?.output ?? 0) + 50,
      };
      state.finalAnswer = {
        title: "T",
        analysis: "A",
        answer: "ANS",
        questions: [],
        hasAnswer: true,
      };
      state.trace = {
        ...state.trace,
        answer: { branchesUsed: [], tokens: { input: 100, output: 50 } },
        totalTokens: state.tokens,
      };
      return state;
    }),
  };
}

describe("ResponderService — unified workflow", () => {
  let service: ResponderService;
  let plannerNode: { execute: Mock };
  let graphNode: { execute: Mock };
  let contextualiserService: { run: Mock };
  let driftSearchService: { search: Mock };
  let answerNode: { execute: Mock };

  beforeEach(async () => {
    plannerNode = { execute: vi.fn() };
    graphNode = { execute: vi.fn().mockResolvedValue(graphSuccessReturn()) };
    contextualiserService = { run: vi.fn().mockResolvedValue(contextualiserSuccessReturn()) };
    driftSearchService = { search: vi.fn().mockResolvedValue(driftSuccessReturn()) };
    answerNode = answerNodeMock();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResponderService,
        ResponderContextFactoryService,
        ContextualiserContextFactoryService,
        { provide: ContextualiserService, useValue: contextualiserService },
        { provide: DriftSearchService, useValue: driftSearchService },
        { provide: ResponderAnswerNodeService, useValue: answerNode },
        { provide: PlannerNodeService, useValue: plannerNode },
        { provide: GraphNodeService, useValue: graphNode },
      ],
    }).compile();

    service = moduleRef.get(ResponderService);
  });

  const baseRunArgs = () => ({
    companyId: TEST_IDS.companyId,
    userId: TEST_IDS.userId,
    userModuleIds: ["crm"],
    dataLimits: MOCK_DATA_LIMITS,
    messages: MOCK_MESSAGES,
  });

  it("runs all three branches when planner picks runGraph + runContextualiser + runDrift", async () => {
    plannerNode.execute.mockResolvedValue(plannerOutput({ runGraph: true, runContextualiser: true, runDrift: true }));

    const result = await service.run(baseRunArgs());

    expect(plannerNode.execute).toHaveBeenCalledTimes(1);
    expect(graphNode.execute).toHaveBeenCalledTimes(1);
    expect(contextualiserService.run).toHaveBeenCalledTimes(1);
    expect(driftSearchService.search).toHaveBeenCalledTimes(1);
    expect(answerNode.execute).toHaveBeenCalledTimes(1);

    expect(result).toBeDefined();
    expect(result.graphContext).toBeDefined();
    expect(result.driftContext).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.answer).toEqual(
      expect.objectContaining({ title: "T", analysis: "A", answer: "ANS", hasAnswer: true }),
    );
    expect(Array.isArray(result.references)).toBe(true);
    expect(Array.isArray(result.sources)).toBe(true);
  });

  it("graph-only: planner runGraph=true skips contextualiser and drift", async () => {
    plannerNode.execute.mockResolvedValue(plannerOutput({ runGraph: true, runContextualiser: false, runDrift: false }));

    await service.run(baseRunArgs());

    expect(graphNode.execute).toHaveBeenCalledTimes(1);
    expect(contextualiserService.run).not.toHaveBeenCalled();
    expect(driftSearchService.search).not.toHaveBeenCalled();
    expect(answerNode.execute).toHaveBeenCalledTimes(1);
  });

  it("contextualiser-only: planner runContextualiser=true skips graph and drift", async () => {
    plannerNode.execute.mockResolvedValue(plannerOutput({ runGraph: false, runContextualiser: true, runDrift: false }));

    await service.run({
      ...baseRunArgs(),
      contentId: TEST_IDS.contentId,
      contentType: "Document",
    });

    expect(graphNode.execute).not.toHaveBeenCalled();
    expect(contextualiserService.run).toHaveBeenCalledTimes(1);
    expect(driftSearchService.search).not.toHaveBeenCalled();
    expect(answerNode.execute).toHaveBeenCalledTimes(1);
  });

  it("drift-only: planner runDrift=true skips graph and contextualiser", async () => {
    plannerNode.execute.mockResolvedValue(plannerOutput({ runGraph: false, runContextualiser: false, runDrift: true }));

    await service.run(baseRunArgs());

    expect(graphNode.execute).not.toHaveBeenCalled();
    expect(contextualiserService.run).not.toHaveBeenCalled();
    expect(driftSearchService.search).toHaveBeenCalledTimes(1);
    expect(answerNode.execute).toHaveBeenCalledTimes(1);
  });

  it("graph + drift: both run, contextualiser does not", async () => {
    plannerNode.execute.mockResolvedValue(plannerOutput({ runGraph: true, runContextualiser: false, runDrift: true }));

    await service.run(baseRunArgs());

    expect(graphNode.execute).toHaveBeenCalledTimes(1);
    expect(contextualiserService.run).not.toHaveBeenCalled();
    expect(driftSearchService.search).toHaveBeenCalledTimes(1);
    expect(answerNode.execute).toHaveBeenCalledTimes(1);
  });

  it("planner picks no branches: edge fallback routes straight to answer", async () => {
    plannerNode.execute.mockResolvedValue(
      plannerOutput({ runGraph: false, runContextualiser: false, runDrift: false }),
    );

    const result = await service.run(baseRunArgs());

    expect(graphNode.execute).not.toHaveBeenCalled();
    expect(contextualiserService.run).not.toHaveBeenCalled();
    expect(driftSearchService.search).not.toHaveBeenCalled();
    expect(answerNode.execute).toHaveBeenCalledTimes(1);
    expect(result.answer).toBeDefined();
  });

  it("planner LLM error fallback runs graph + contextualiser, not drift", async () => {
    const fallbackPlan = {
      runGraph: true,
      runContextualiser: true,
      runDrift: false,
      reasoning: "planner_fallback",
    };
    plannerNode.execute.mockResolvedValue({
      branchPlan: fallbackPlan,
      question: "What is the latest order for Acme?",
      plannerError: "LLM 500",
      trace: {
        planner: {
          reasoning: "planner_fallback",
          branchPlan: fallbackPlan,
          tokens: { input: 0, output: 0 },
        },
        totalTokens: { input: 0, output: 0 },
      } as any,
    });

    await service.run(baseRunArgs());

    expect(graphNode.execute).toHaveBeenCalledTimes(1);
    expect(contextualiserService.run).toHaveBeenCalledTimes(1);
    expect(driftSearchService.search).not.toHaveBeenCalled();
    expect(answerNode.execute).toHaveBeenCalledTimes(1);
  });

  it("graph branch failure in isolation: response built, answer node still runs", async () => {
    plannerNode.execute.mockResolvedValue(plannerOutput({ runGraph: true, runContextualiser: true, runDrift: false }));
    graphNode.execute.mockResolvedValue(graphFailedReturn("tool fault"));

    const result = await service.run(baseRunArgs());

    expect(graphNode.execute).toHaveBeenCalledTimes(1);
    expect(contextualiserService.run).toHaveBeenCalledTimes(1);
    expect(answerNode.execute).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    expect(result.answer).toBeDefined();
    expect((result.trace as any)?.graph?.status).toBe("failed");
  });

  it("contextualiser branch failure in isolation: response built, answer node still runs", async () => {
    plannerNode.execute.mockResolvedValue(plannerOutput({ runGraph: true, runContextualiser: true, runDrift: false }));
    contextualiserService.run.mockRejectedValue(new Error("contextualiser exploded"));

    const result = await service.run(baseRunArgs());

    expect(graphNode.execute).toHaveBeenCalledTimes(1);
    expect(contextualiserService.run).toHaveBeenCalledTimes(1);
    expect(answerNode.execute).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    expect(result.answer).toBeDefined();
    expect((result.trace as any)?.contextualiser?.status).toBe("failed");
  });

  it("drift branch failure in isolation: response built, answer node still runs", async () => {
    plannerNode.execute.mockResolvedValue(plannerOutput({ runGraph: false, runContextualiser: false, runDrift: true }));
    driftSearchService.search.mockRejectedValue(new Error("drift exploded"));

    const result = await service.run(baseRunArgs());

    expect(driftSearchService.search).toHaveBeenCalledTimes(1);
    expect(answerNode.execute).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    expect(result.answer).toBeDefined();
    expect((result.trace as any)?.drift?.status).toBe("failed");
  });

  it("answer LLM error re-throws", async () => {
    plannerNode.execute.mockResolvedValue(
      plannerOutput({ runGraph: false, runContextualiser: false, runDrift: false }),
    );
    answerNode.execute.mockRejectedValue(new Error("answer LLM down"));

    await expect(service.run(baseRunArgs())).rejects.toThrow(/answer LLM down/);
  });
});
