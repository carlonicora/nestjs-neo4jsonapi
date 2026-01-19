import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { ContextualiserService } from "../contextualiser.service";
import { ContextualiserContextFactoryService } from "../../factories/contextualiser.context.factory";
import { QuestionRefinerNodeService } from "../../nodes/question.refiner.node.service";
import { RationalNodeService } from "../../nodes/rational.node.service";
import { KeyConceptsNodeService } from "../../nodes/keyconcepts.node.service";
import { AtomicFactsNodeService } from "../../nodes/atomicfacts.node.service";
import { ChunkNodeService } from "../../nodes/chunk.node.service";
import { TracingService } from "../../../../core/tracing/services/tracing.service";
import { ContextualiserContextState } from "../../contexts/contextualiser.context";

// Create mock invoke function that can be controlled by tests
const mockInvoke = vi.fn();

// Mock LangGraph modules
vi.mock("@langchain/langgraph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langchain/langgraph")>();

  // Create a proper class for StateGraph
  class MockStateGraph {
    addNode() {
      return this;
    }
    addEdge() {
      return this;
    }
    addConditionalEdges() {
      return this;
    }
    compile() {
      return {
        invoke: mockInvoke,
      };
    }
  }

  // Create a proper class for MemorySaver
  class MockMemorySaver {}

  return {
    ...actual,
    START: "START",
    END: "END",
    StateGraph: MockStateGraph,
    MemorySaver: MockMemorySaver,
  };
});

describe("ContextualiserService", () => {
  let service: ContextualiserService;
  let contextFactory: MockedObject<ContextualiserContextFactoryService>;
  let clsService: MockedObject<ClsService>;
  let tracingService: MockedObject<TracingService>;

  const TEST_IDS = {
    companyId: "550e8400-e29b-41d4-a716-446655440000",
    contentId: "660e8400-e29b-41d4-a716-446655440001",
  };

  const createMockContextFactory = () => ({
    create: vi.fn(),
  });

  const createMockNodeService = () => ({
    execute: vi.fn(),
  });

  const createMockClsService = () => ({
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn(),
  });

  const createMockTracingService = () => ({
    startSpan: vi.fn(),
    addSpanEvent: vi.fn(),
    setSpanSuccess: vi.fn(),
    setSpanError: vi.fn(),
    endSpan: vi.fn(),
  });

  const createMockInitialState = (overrides: Partial<ContextualiserContextState> = {}): ContextualiserContextState =>
    ({
      companyId: TEST_IDS.companyId,
      contentId: TEST_IDS.contentId,
      contentType: "Document",
      question: "What is this about?",
      hops: 0,
      nextStep: "answer",
      status: [],
      context: "",
      keyConcepts: [],
      atomicFacts: [],
      chunks: [],
      ...overrides,
    }) as ContextualiserContextState;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockContextFactory = createMockContextFactory();
    const mockQuestionRefinerNode = createMockNodeService();
    const mockRationalNode = createMockNodeService();
    const mockKeyConceptsNode = createMockNodeService();
    const mockAtomicFactsNode = createMockNodeService();
    const mockChunkNode = createMockNodeService();
    const mockClsService = createMockClsService();
    const mockTracingService = createMockTracingService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextualiserService,
        { provide: ContextualiserContextFactoryService, useValue: mockContextFactory },
        { provide: QuestionRefinerNodeService, useValue: mockQuestionRefinerNode },
        { provide: RationalNodeService, useValue: mockRationalNode },
        { provide: KeyConceptsNodeService, useValue: mockKeyConceptsNode },
        { provide: AtomicFactsNodeService, useValue: mockAtomicFactsNode },
        { provide: ChunkNodeService, useValue: mockChunkNode },
        { provide: ClsService, useValue: mockClsService },
        { provide: TracingService, useValue: mockTracingService },
      ],
    }).compile();

    service = module.get<ContextualiserService>(ContextualiserService);
    contextFactory = module.get(
      ContextualiserContextFactoryService,
    ) as MockedObject<ContextualiserContextFactoryService>;
    clsService = module.get(ClsService) as MockedObject<ClsService>;
    tracingService = module.get(TracingService) as MockedObject<TracingService>;

    // Reset mockInvoke for each test
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("run", () => {
    it("should start tracing span with correct attributes for empty messages", async () => {
      // Arrange
      const initialState = createMockInitialState();
      contextFactory.create.mockReturnValue(initialState);
      mockInvoke.mockResolvedValue(initialState);

      // Act
      await service.run({
        companyId: TEST_IDS.companyId,
        contentId: TEST_IDS.contentId,
        contentType: "Document",
        dataLimits: { keyConcepts: 10, atomicFacts: 20, chunks: 5 },
        messages: [],
        question: "What is this?",
      });

      // Assert
      expect(tracingService.startSpan).toHaveBeenCalledWith("Contextualiser Workflow", {
        attributes: expect.objectContaining({
          companyId: TEST_IDS.companyId,
          contentId: TEST_IDS.contentId,
          contentType: "Document",
          messagesCount: 0,
          question: "What is this?",
          maxHops: 20,
          recursionLimit: 22,
          initialNode: "question_refiner",
        }),
      });
    });

    it("should use rational_plan as initial node when messages exist", async () => {
      // Arrange
      const initialState = createMockInitialState();
      contextFactory.create.mockReturnValue(initialState);
      mockInvoke.mockResolvedValue(initialState);

      // Act
      await service.run({
        companyId: TEST_IDS.companyId,
        contentId: TEST_IDS.contentId,
        contentType: "Document",
        dataLimits: { keyConcepts: 10, atomicFacts: 20, chunks: 5 },
        messages: [{ role: "user", content: "Hello" }],
        question: "What is this?",
      });

      // Assert
      expect(tracingService.startSpan).toHaveBeenCalledWith(
        "Contextualiser Workflow",
        expect.objectContaining({
          attributes: expect.objectContaining({
            initialNode: "rational_plan",
            messagesCount: 1,
          }),
        }),
      );
    });

    it("should create initial state using context factory", async () => {
      // Arrange
      const initialState = createMockInitialState();
      contextFactory.create.mockReturnValue(initialState);
      mockInvoke.mockResolvedValue(initialState);

      const dataLimits = { keyConcepts: 10, atomicFacts: 20, chunks: 5 };
      const messages = [{ role: "user", content: "Hello" }];

      // Act
      await service.run({
        companyId: TEST_IDS.companyId,
        contentId: TEST_IDS.contentId,
        contentType: "Document",
        dataLimits,
        messages,
        question: "What is this?",
      });

      // Assert
      expect(contextFactory.create).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        contentId: TEST_IDS.contentId,
        contentType: "Document",
        dataLimits,
        question: "What is this?",
        mainPrompt: undefined,
        finalPrompt: undefined,
        previousMessages: messages,
        preselectedChunks: [],
      });
    });

    it("should return final state from workflow execution", async () => {
      // Arrange
      const initialState = createMockInitialState();
      const finalState = createMockInitialState({
        hops: 5,
        context: "Final context",
      });
      contextFactory.create.mockReturnValue(initialState);
      mockInvoke.mockResolvedValue(finalState);

      // Act
      const result = await service.run({
        companyId: TEST_IDS.companyId,
        contentId: TEST_IDS.contentId,
        contentType: "Document",
        dataLimits: { keyConcepts: 10, atomicFacts: 20, chunks: 5 },
        messages: [],
        question: "What is this?",
      });

      // Assert
      expect(result).toEqual(finalState);
    });

    it("should set span success and end span on successful completion", async () => {
      // Arrange
      const initialState = createMockInitialState();
      contextFactory.create.mockReturnValue(initialState);
      mockInvoke.mockResolvedValue(initialState);

      // Act
      await service.run({
        companyId: TEST_IDS.companyId,
        contentId: TEST_IDS.contentId,
        contentType: "Document",
        dataLimits: { keyConcepts: 10, atomicFacts: 20, chunks: 5 },
        messages: [],
        question: "What is this?",
      });

      // Assert
      expect(tracingService.setSpanSuccess).toHaveBeenCalled();
      expect(tracingService.endSpan).toHaveBeenCalled();
    });

    it("should set span error and end span on workflow failure", async () => {
      // Arrange
      const initialState = createMockInitialState();
      contextFactory.create.mockReturnValue(initialState);
      const error = new Error("Workflow failed");
      mockInvoke.mockRejectedValue(error);

      // Act & Assert
      await expect(
        service.run({
          companyId: TEST_IDS.companyId,
          contentId: TEST_IDS.contentId,
          contentType: "Document",
          dataLimits: { keyConcepts: 10, atomicFacts: 20, chunks: 5 },
          messages: [],
          question: "What is this?",
        }),
      ).rejects.toThrow("Workflow failed");

      expect(tracingService.setSpanError).toHaveBeenCalledWith(error);
      expect(tracingService.endSpan).toHaveBeenCalled();
    });

    it("should handle question being undefined", async () => {
      // Arrange
      const initialState = createMockInitialState();
      contextFactory.create.mockReturnValue(initialState);
      mockInvoke.mockResolvedValue(initialState);

      // Act
      await service.run({
        companyId: TEST_IDS.companyId,
        contentId: TEST_IDS.contentId,
        contentType: "Document",
        dataLimits: { keyConcepts: 10, atomicFacts: 20, chunks: 5 },
        messages: [],
        // question is undefined
      });

      // Assert
      expect(tracingService.startSpan).toHaveBeenCalledWith(
        "Contextualiser Workflow",
        expect.objectContaining({
          attributes: expect.objectContaining({
            question: "none",
          }),
        }),
      );
    });

    it("should add workflow executing span event", async () => {
      // Arrange
      const initialState = createMockInitialState();
      contextFactory.create.mockReturnValue(initialState);
      mockInvoke.mockResolvedValue(initialState);

      // Act
      await service.run({
        companyId: TEST_IDS.companyId,
        contentId: TEST_IDS.contentId,
        contentType: "Document",
        dataLimits: { keyConcepts: 10, atomicFacts: 20, chunks: 5 },
        messages: [],
        question: "What is this?",
      });

      // Assert
      expect(tracingService.addSpanEvent).toHaveBeenCalledWith("Workflow Executing");
    });

    it("should add workflow completed span event with final hop count", async () => {
      // Arrange
      const initialState = createMockInitialState();
      const finalState = createMockInitialState({ hops: 8 });
      contextFactory.create.mockReturnValue(initialState);
      mockInvoke.mockResolvedValue(finalState);

      // Act
      await service.run({
        companyId: TEST_IDS.companyId,
        contentId: TEST_IDS.contentId,
        contentType: "Document",
        dataLimits: { keyConcepts: 10, atomicFacts: 20, chunks: 5 },
        messages: [],
        question: "What is this?",
      });

      // Assert
      expect(tracingService.addSpanEvent).toHaveBeenCalledWith("Workflow Completed", {
        finalHopCount: 8,
        totalSteps: 0,
      });
    });

    it("should invoke workflow with recursion limit", async () => {
      // Arrange
      const initialState = createMockInitialState();
      contextFactory.create.mockReturnValue(initialState);
      mockInvoke.mockResolvedValue(initialState);

      // Act
      await service.run({
        companyId: TEST_IDS.companyId,
        contentId: TEST_IDS.contentId,
        contentType: "Document",
        dataLimits: { keyConcepts: 10, atomicFacts: 20, chunks: 5 },
        messages: [],
        question: "What is this?",
      });

      // Assert
      expect(mockInvoke).toHaveBeenCalledWith(
        initialState,
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: expect.any(String),
          }),
          recursionLimit: 22,
        }),
      );
    });
  });
});
