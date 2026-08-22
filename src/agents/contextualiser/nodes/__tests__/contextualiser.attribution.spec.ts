import { beforeEach, describe, expect, it, vi } from "vitest";
import { modelRegistry } from "../../../../common/registries/registry";
import { TokenUsageType } from "../../../../foundations/tokenusage/enums/tokenusage.type";
import { ContextualiserContextState } from "../../contexts/contextualiser.context";
import { AtomicFactsNodeService } from "../atomicfacts.node.service";
import { ChunkNodeService } from "../chunk.node.service";
import { ChunkVectorNodeService } from "../chunk.vector.node.service";
import { KeyConceptsNodeService } from "../keyconcepts.node.service";
import { QuestionRefinerNodeService } from "../question.refiner.node.service";
import { RationalNodeService } from "../rational.node.service";

/**
 * The contextualiser is a SUB-AGENT: another agent invokes it, and the owner's
 * ruling is that the CALLING agent records the spend. So every one of its six
 * `llm.call` sites must carry the caller's ledger category and the caller's
 * entity — never a category of its own, and never a JSON:API type where the
 * `USED_FOR` edge expects a Neo4j label.
 */
describe("contextualiser — inherited usage attribution", () => {
  modelRegistry.register({ nodeName: "campaign", labelName: "Campaign", type: "campaigns" } as never);

  let llmService: { call: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };
  let clsService: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let webSocketService: { sendMessageToUser: ReturnType<typeof vi.fn> };
  // chunk_vector now embeds the question ONCE per turn and shares the vector
  // through the graph state, so the node takes EmbedderService directly.
  let embedderService: { vectoriseText: ReturnType<typeof vi.fn> };
  let logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
  let tracer: { addSpanEvent: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    llmService = {
      call: vi.fn().mockResolvedValue({
        status: "s",
        annotations: "a",
        response: "refined question",
        rationalPlan: "plan",
        keyConcepts: [],
        chunksToAnalyse: ["chunk-1"],
        note: { content: "c", reason: "r" },
        chosenAction: "answer",
        tokenUsage: { input: 1, output: 1 },
      }),
    };
    configService = { get: vi.fn().mockReturnValue({}) };
    clsService = { get: vi.fn(), set: vi.fn() };
    webSocketService = { sendMessageToUser: vi.fn() };
    embedderService = { vectoriseText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
    logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    tracer = { addSpanEvent: vi.fn() };
  });

  const createState = (overrides?: Partial<ContextualiserContextState>): ContextualiserContextState =>
    ({
      companyId: "company-1",
      // Deliberately unbound: this suite is about the CALLER's attribution, not
      // the content-level fallback Task 8 wired for retrieval embeddings.
      contentId: "",
      contentType: "",
      hops: 0,
      limits: {},
      question: "Who runs the trading post?",
      rationalPlan: "plan",
      chatHistory: [{ type: "user", content: "earlier" }],
      notebook: [],
      status: [],
      nextStep: "key_concepts",
      queuedKeyConcepts: ["kc-1"],
      processedKeyConcepts: [],
      processedAtomicFacts: [],
      processedChunks: [],
      queuedChunks: ["chunk-1"],
      tokens: { input: 0, output: 0 },
      // The caller's attribution, seeded by ContextualiserService.run.
      tokenUsageType: TokenUsageType.Responder,
      scopeId: "campaign-1",
      scopeLabel: "Campaign",
      ...overrides,
    }) as ContextualiserContextState;

  /** Every node, built with just enough collaborators to reach its `llm.call`. */
  // `chunks` and `chunk_vector` are DELIBERATELY absent from this table. Block
  // 3c removed their per-chunk LLM call entirely, so there is no call left to
  // carry attribution — asserting `llmService.call` was billed correctly would
  // assert a call that can never happen. Their remaining attribution duty is the
  // retrieval EMBEDDING, covered by its own test below.
  const nodes: { name: string; run: (state: ContextualiserContextState) => Promise<unknown> }[] = [
    {
      name: "rational_plan",
      run: (state) =>
        new RationalNodeService(
          llmService as never,
          webSocketService as never,
          clsService as never,
          configService as never,
        ).execute({ state: state as never }),
    },
    {
      name: "question_refiner",
      run: (state) =>
        new QuestionRefinerNodeService(
          llmService as never,
          webSocketService as never,
          clsService as never,
          configService as never,
        ).execute({ state: state as never }),
    },
    {
      name: "key_concepts",
      run: (state) =>
        new KeyConceptsNodeService(
          llmService as never,
          { findPotentialKeyConcepts: vi.fn().mockResolvedValue([{ value: "kc-1" }]) } as never,
          webSocketService as never,
          clsService as never,
          configService as never,
        ).execute({ state: state as never }),
    },
    {
      name: "atomic_facts",
      run: (state) =>
        new AtomicFactsNodeService(
          llmService as never,
          {
            findAtomicFactsByKeyConcepts: vi
              .fn()
              .mockResolvedValue([{ id: "af-1", content: "a fact", chunk: { id: "chunk-9" } }]),
          } as never,
          logger as never,
          tracer as never,
          webSocketService as never,
          clsService as never,
          configService as never,
        ).execute({ state: state as never }),
    },
  ];

  for (const node of nodes) {
    describe(node.name, () => {
      it("bills the caller's scope root, as the caller", async () => {
        await node.run(createState());

        expect(llmService.call).toHaveBeenCalled();
        for (const [args] of llmService.call.mock.calls) {
          expect(args).toMatchObject({
            tokenUsageType: TokenUsageType.Responder,
            relationshipId: "campaign-1",
            relationshipType: "Campaign",
          });
        }
      });

      it("translates a bare JSON:API scopeType into its Neo4j label", async () => {
        await node.run(createState({ scopeLabel: undefined, scopeType: "campaigns" }));

        expect(llmService.call).toHaveBeenCalled();
        for (const [args] of llmService.call.mock.calls) {
          expect(args.relationshipType).toBe("Campaign");
        }
      });

      it("falls back to the caller's assistant thread when the turn has no scope root", async () => {
        await node.run(createState({ scopeId: undefined, scopeLabel: undefined, assistantId: "assistant-1" }));

        expect(llmService.call).toHaveBeenCalled();
        for (const [args] of llmService.call.mock.calls) {
          expect(args).toMatchObject({
            tokenUsageType: TokenUsageType.Responder,
            relationshipId: "assistant-1",
            relationshipType: "Assistant",
          });
        }
      });

      it("records nothing when the caller supplied no attribution at all", async () => {
        await node.run(
          createState({ tokenUsageType: undefined, scopeId: undefined, scopeLabel: undefined, assistantId: undefined }),
        );

        expect(llmService.call).toHaveBeenCalled();
        for (const [args] of llmService.call.mock.calls) {
          // No entity => `persistUsage` skips the record; the sub-agent never
          // invents a category of its own to fill the gap.
          expect(args.relationshipId).toBeUndefined();
          expect(args.relationshipType).toBeUndefined();
          expect(args.tokenUsageType).toBe(TokenUsageType.TextGeneration);
        }
      });
    });
  }

  it("bills the retrieval embedding to the caller's scope too, so one turn lands on one entity", async () => {
    const chunkRepository = {
      findPotentialChunks: vi.fn().mockResolvedValue([{ id: "chunk-1", content: "text" }]),
      findChunkNeighbors: vi.fn().mockResolvedValue([]),
    };
    await new ChunkVectorNodeService(chunkRepository as never, embedderService as never).execute({
      state: createState({ contentId: "content-1", contentType: "campaigns" }) as never,
    });

    expect(chunkRepository.findPotentialChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        attribution: { relationshipId: "campaign-1", relationshipType: "Campaign" },
      }),
    );
  });

  it("keeps ContextualiserContextState constructible without the attribution keys", () => {
    // `ContextualiserService.run` returns this type, so it is reachable from
    // outside the package. This only COMPILES if the five attribution keys are
    // optional — the regression a required LangGraph channel would cause.
    const preTask10: ContextualiserContextState = {
      companyId: "company-1",
      contentId: "",
      contentType: "",
      hops: 0,
      previousAnalysis: "",
      previousAnswer: "",
      limits: {},
      prompts: { initial: "", answer: "" },
      status: [],
      chatHistory: [],
      question: "q",
      rationalPlan: "",
      annotations: "",
      notebook: [],
      chunkLevel: 0,
      queuedChunks: [],
      queuedKeyConcepts: [],
      processedChunks: [],
      processedKeyConcepts: [],
      processedAtomicFacts: [],
      processedNeighbours: [],
      neighbouringAlreadyExplored: false,
      sources: [],
      ontology: [],
      requests: [],
      nextStep: "rational_plan",
      tokens: { input: 0, output: 0 },
    };

    expect(preTask10.scopeId).toBeUndefined();
  });
});
