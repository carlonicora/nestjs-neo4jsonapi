import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { DriftSearchService } from "../drift.search.service";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { TracingService } from "../../../../core/tracing/services/tracing.service";
import { HydeNodeService } from "../../nodes/hyde.node.service";
import { CommunitySearchNodeService } from "../../nodes/community.search.node.service";
import { PrimerAnswerNodeService } from "../../nodes/primer.answer.node.service";
import { FollowUpNodeService } from "../../nodes/followup.node.service";
import { SynthesisNodeService } from "../../nodes/synthesis.node.service";
import { DriftContextState } from "../../contexts/drift.context";

describe("DriftSearchService", () => {
  let service: DriftSearchService;
  let hydeNode: MockedObject<HydeNodeService>;
  let communitySearchNode: MockedObject<CommunitySearchNodeService>;
  let primerAnswerNode: MockedObject<PrimerAnswerNodeService>;
  let followUpNode: MockedObject<FollowUpNodeService>;
  let synthesisNode: MockedObject<SynthesisNodeService>;
  let logger: MockedObject<AppLoggingService>;
  let tracer: MockedObject<TracingService>;

  const TEST_IDS = {
    communityId: "550e8400-e29b-41d4-a716-446655440000",
  };

  const MOCK_COMMUNITIES = [
    {
      id: TEST_IDS.communityId,
      name: "Test Community",
      level: 0,
      memberCount: 5,
      rating: 50,
      summary: "A test community about AI",
    },
  ];

  const createMockLogger = () => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    logWithContext: vi.fn(),
    errorWithContext: vi.fn(),
    setRequestContext: vi.fn(),
    getRequestContext: vi.fn(),
    clearRequestContext: vi.fn(),
    createChildLogger: vi.fn(),
    logHttpRequest: vi.fn(),
    logHttpError: vi.fn(),
    logBusinessEvent: vi.fn(),
    logSecurityEvent: vi.fn(),
  });

  const createMockTracer = () => ({
    startSpan: vi.fn(),
    endSpan: vi.fn(),
    addSpanEvent: vi.fn(),
    setSpanSuccess: vi.fn(),
    setSpanError: vi.fn(),
    getTracer: vi.fn(),
    getCurrentSpan: vi.fn(),
    setSpanAttributes: vi.fn(),
    recordException: vi.fn(),
  });

  const createMockHydeNode = () => ({
    execute: vi.fn(),
  });

  const createMockCommunitySearchNode = () => ({
    execute: vi.fn(),
  });

  const createMockPrimerAnswerNode = () => ({
    execute: vi.fn(),
  });

  const createMockFollowUpNode = () => ({
    execute: vi.fn(),
  });

  const createMockSynthesisNode = () => ({
    execute: vi.fn(),
  });

  // Helper to create a partial state that simulates workflow progression
  const createPartialState = (
    overrides: Partial<DriftContextState>,
    state: DriftContextState,
  ): Partial<DriftContextState> => {
    return {
      ...overrides,
      hops: state.hops + 1,
    };
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockLogger = createMockLogger();
    const mockTracer = createMockTracer();
    const mockHydeNode = createMockHydeNode();
    const mockCommunitySearchNode = createMockCommunitySearchNode();
    const mockPrimerAnswerNode = createMockPrimerAnswerNode();
    const mockFollowUpNode = createMockFollowUpNode();
    const mockSynthesisNode = createMockSynthesisNode();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftSearchService,
        { provide: AppLoggingService, useValue: mockLogger },
        { provide: TracingService, useValue: mockTracer },
        { provide: HydeNodeService, useValue: mockHydeNode },
        { provide: CommunitySearchNodeService, useValue: mockCommunitySearchNode },
        { provide: PrimerAnswerNodeService, useValue: mockPrimerAnswerNode },
        { provide: FollowUpNodeService, useValue: mockFollowUpNode },
        { provide: SynthesisNodeService, useValue: mockSynthesisNode },
      ],
    }).compile();

    service = module.get<DriftSearchService>(DriftSearchService);
    logger = module.get(AppLoggingService) as MockedObject<AppLoggingService>;
    tracer = module.get(TracingService) as MockedObject<TracingService>;
    hydeNode = module.get(HydeNodeService) as MockedObject<HydeNodeService>;
    communitySearchNode = module.get(CommunitySearchNodeService) as MockedObject<CommunitySearchNodeService>;
    primerAnswerNode = module.get(PrimerAnswerNodeService) as MockedObject<PrimerAnswerNodeService>;
    followUpNode = module.get(FollowUpNodeService) as MockedObject<FollowUpNodeService>;
    synthesisNode = module.get(SynthesisNodeService) as MockedObject<SynthesisNodeService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("search", () => {
    it("should execute the complete DRIFT workflow", async () => {
      // Arrange - Set up mock responses for each node in the workflow
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState(
          {
            hypotheticalAnswer: "This is a hypothetical answer about AI",
            hydeEmbedding: [0.1, 0.2, 0.3],
            nextStep: "community_search",
          },
          state,
        ),
      );

      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState(
          {
            matchedCommunities: MOCK_COMMUNITIES,
            communitySummaries: "Summary of AI community",
            nextStep: "primer_answer",
          },
          state,
        ),
      );

      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState(
          {
            initialAnswer: "Initial answer about AI",
            followUpQuestions: [],
            confidence: 0.85,
            nextStep: "synthesis",
          },
          state,
        ),
      );

      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState(
          {
            finalAnswer: "Final synthesized answer about AI",
            nextStep: "end",
          },
          state,
        ),
      );

      // Act
      const result = await service.search({ question: "What is AI?" });

      // Assert
      expect(result.answer).toBe("Final synthesized answer about AI");
      expect(result.matchedCommunities).toEqual(MOCK_COMMUNITIES);
      expect(result.initialAnswer).toBe("Initial answer about AI");
      expect(result.confidence).toBe(0.85);
      expect(result.hydeEmbedding).toEqual([0.1, 0.2, 0.3]);
    });

    it("should log workflow start and completion", async () => {
      // Arrange
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "synthesis", confidence: 0.5 }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "Answer", nextStep: "end" }, state),
      );

      // Act
      await service.search({ question: "Test question" });

      // Assert
      expect(logger.log).toHaveBeenCalledWith('Starting DRIFT search for: "Test question"', "DriftSearchService");
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("DRIFT search complete"), "DriftSearchService");
    });

    it("should start and end tracing span", async () => {
      // Arrange
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "synthesis", confidence: 0.5 }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "Answer", nextStep: "end" }, state),
      );

      // Act
      await service.search({ question: "Test question" });

      // Assert
      expect(tracer.startSpan).toHaveBeenCalledWith(
        "DRIFT Search Workflow",
        expect.objectContaining({
          attributes: expect.objectContaining({ question: "Test question" }),
        }),
      );
      expect(tracer.setSpanSuccess).toHaveBeenCalled();
      expect(tracer.endSpan).toHaveBeenCalled();
    });

    it("should use default config values when not provided", async () => {
      // Arrange
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "synthesis", confidence: 0.5 }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "Answer", nextStep: "end" }, state),
      );

      // Act
      await service.search({ question: "Test" });

      // Assert - Check tracer was called with default topK (5) and maxDepth (2)
      expect(tracer.startSpan).toHaveBeenCalledWith(
        "DRIFT Search Workflow",
        expect.objectContaining({
          attributes: expect.objectContaining({
            topK: 5,
            maxDepth: 2,
          }),
        }),
      );
    });

    it("should use custom config values when provided", async () => {
      // Arrange
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "synthesis", confidence: 0.5 }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "Answer", nextStep: "end" }, state),
      );

      // Act
      await service.search({
        question: "Test",
        config: { primerTopK: 10, followUpDepth: 3 },
      });

      // Assert
      expect(tracer.startSpan).toHaveBeenCalledWith(
        "DRIFT Search Workflow",
        expect.objectContaining({
          attributes: expect.objectContaining({
            topK: 10,
            maxDepth: 3,
          }),
        }),
      );
    });

    it("should handle workflow errors and log them", async () => {
      // Arrange
      const error = new Error("Node execution failed");
      hydeNode.execute.mockRejectedValue(error);

      // Act & Assert
      await expect(service.search({ question: "Test" })).rejects.toThrow("Node execution failed");
      expect(logger.error).toHaveBeenCalledWith("DRIFT workflow failed: Node execution failed", "DriftSearchService");
      expect(tracer.setSpanError).toHaveBeenCalledWith(error);
      expect(tracer.endSpan).toHaveBeenCalled();
    });

    it("should process follow-up questions when they exist", async () => {
      // Arrange
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [0.1], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: MOCK_COMMUNITIES, nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState(
          {
            initialAnswer: "Initial",
            followUpQuestions: ["What else?"],
            confidence: 0.7,
            nextStep: "followup",
          },
          state,
        ),
      );
      followUpNode.execute.mockImplementation(async ({ state }) =>
        createPartialState(
          {
            followUpAnswers: [{ question: "What else?", answer: "More details" }],
            nextStep: "synthesis",
          },
          state,
        ),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "Complete answer", nextStep: "end" }, state),
      );

      // Act
      const result = await service.search({ question: "What is AI?" });

      // Assert
      expect(followUpNode.execute).toHaveBeenCalled();
      expect(result.followUpAnswers).toEqual([{ question: "What else?", answer: "More details" }]);
    });

    it("should add span events for each node execution", async () => {
      // Arrange
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "synthesis", confidence: 0.5 }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "Answer", nextStep: "end" }, state),
      );

      // Act
      await service.search({ question: "Test" });

      // Assert - Verify span events were added
      expect(tracer.addSpanEvent).toHaveBeenCalledWith(expect.stringContaining("Node: hyde"), expect.any(Object));
      expect(tracer.addSpanEvent).toHaveBeenCalledWith(
        expect.stringContaining("Node: community_search"),
        expect.any(Object),
      );
      expect(tracer.addSpanEvent).toHaveBeenCalledWith(
        expect.stringContaining("Node: primer_answer"),
        expect.any(Object),
      );
      expect(tracer.addSpanEvent).toHaveBeenCalledWith(expect.stringContaining("Node: synthesis"), expect.any(Object));
    });

    it("should return empty arrays for unset result fields", async () => {
      // Arrange
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ initialAnswer: "", followUpQuestions: [], confidence: 0, nextStep: "synthesis" }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "", nextStep: "end" }, state),
      );

      // Act
      const result = await service.search({ question: "Test" });

      // Assert
      expect(result.matchedCommunities).toEqual([]);
      expect(result.followUpAnswers).toEqual([]);
      expect(result.hydeEmbedding).toEqual([]);
    });
  });

  describe("quickSearch", () => {
    it("should call search with followUpDepth set to 0", async () => {
      // Arrange
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "synthesis", confidence: 0.5 }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "Quick answer", nextStep: "end" }, state),
      );

      // Act
      const result = await service.quickSearch({ question: "Quick test" });

      // Assert
      expect(result.answer).toBe("Quick answer");
      expect(tracer.startSpan).toHaveBeenCalledWith(
        "DRIFT Search Workflow",
        expect.objectContaining({
          attributes: expect.objectContaining({
            maxDepth: 0, // followUpDepth should be 0 for quick search
          }),
        }),
      );
    });

    it("should use custom topK when provided", async () => {
      // Arrange
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "synthesis", confidence: 0.5 }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "Answer", nextStep: "end" }, state),
      );

      // Act
      await service.quickSearch({ question: "Test", topK: 15 });

      // Assert
      expect(tracer.startSpan).toHaveBeenCalledWith(
        "DRIFT Search Workflow",
        expect.objectContaining({
          attributes: expect.objectContaining({
            topK: 15,
          }),
        }),
      );
    });

    it("should use default topK of 5 when not provided", async () => {
      // Arrange
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "synthesis", confidence: 0.5 }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "Answer", nextStep: "end" }, state),
      );

      // Act
      await service.quickSearch({ question: "Test" });

      // Assert
      expect(tracer.startSpan).toHaveBeenCalledWith(
        "DRIFT Search Workflow",
        expect.objectContaining({
          attributes: expect.objectContaining({
            topK: 5,
          }),
        }),
      );
    });
  });

  /**
   * The SEEDING junction (Task 10). The node specs prove each node applies the
   * attribution it finds on its state; this proves `search()` is what PUTS it
   * there. Without these, deleting the five assignments in `initialState` breaks
   * billing in production and fails no test.
   */
  describe("caller attribution seeding", () => {
    const driveToEnd = () => {
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ hydeEmbedding: [], nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "synthesis", confidence: 0.5 }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "Answer", nextStep: "end" }, state),
      );
    };

    it("seeds the caller's attribution into the state every node receives", async () => {
      driveToEnd();

      await service.search({
        question: "Test",
        attribution: {
          tokenUsageType: "responder",
          scopeId: "campaign-1",
          scopeType: "campaigns",
          scopeLabel: "Campaign",
          assistantId: "assistant-1",
        },
      });

      // Asserted on EVERY node, not just the first: the channels must survive
      // the reducers for the whole run, or later nodes bill nothing.
      for (const node of [hydeNode, communitySearchNode, primerAnswerNode, synthesisNode]) {
        expect(node.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            state: expect.objectContaining({
              tokenUsageType: "responder",
              scopeId: "campaign-1",
              scopeType: "campaigns",
              scopeLabel: "Campaign",
              assistantId: "assistant-1",
            }),
          }),
        );
      }
    });

    it("leaves the attribution channels undefined when the caller supplies none", async () => {
      driveToEnd();

      await service.search({ question: "Test" });

      const state = hydeNode.execute.mock.calls[0][0].state;
      expect(state.tokenUsageType).toBeUndefined();
      expect(state.scopeId).toBeUndefined();
      expect(state.assistantId).toBeUndefined();
    });

    it("forwards the attribution through quickSearch too", async () => {
      driveToEnd();

      await service.quickSearch({ question: "Test", attribution: { scopeId: "campaign-1", scopeLabel: "Campaign" } });

      expect(hydeNode.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining({ scopeId: "campaign-1", scopeLabel: "Campaign" }),
        }),
      );
    });
  });

  /**
   * Logging must be PROPORTIONATE: an MCP tool call names no entity on every
   * single request and is right to, so it must not warn. A caller that names
   * something unbillable is a real fault and must.
   */
  describe("unattributed-run logging", () => {
    const driveToEnd = () => {
      hydeNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "community_search" }, state),
      );
      communitySearchNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ matchedCommunities: [], nextStep: "primer_answer" }, state),
      );
      primerAnswerNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ nextStep: "synthesis" }, state),
      );
      synthesisNode.execute.mockImplementation(async ({ state }) =>
        createPartialState({ finalAnswer: "A", nextStep: "end" }, state),
      );
    };

    it("does NOT warn when the caller names no entity at all (the MCP path)", async () => {
      driveToEnd();

      await service.search({ question: "Test", attribution: { tokenUsageType: "operator" } });

      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("no cost attribution"), "DriftSearchService");
    });

    it("does not warn for a completely absent attribution either", async () => {
      driveToEnd();

      await service.search({ question: "Test" });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("WARNS when the caller names an entity that cannot be billed", async () => {
      driveToEnd();

      // A scopeId whose type no model claims: looks attributed, records nothing.
      await service.search({
        question: "Test",
        attribution: { tokenUsageType: "responder", scopeId: "widget-1", scopeType: "widgets" },
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("UNRESOLVABLE cost attribution"),
        "DriftSearchService",
      );
    });

    it("does not warn on a billable run", async () => {
      driveToEnd();

      await service.search({ question: "Test", attribution: { scopeId: "campaign-1", scopeLabel: "Campaign" } });

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
