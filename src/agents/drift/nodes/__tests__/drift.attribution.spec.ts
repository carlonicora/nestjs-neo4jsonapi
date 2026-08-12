import { beforeEach, describe, expect, it, vi } from "vitest";
import { modelRegistry } from "../../../../common/registries/registry";
import { TokenUsageType } from "../../../../foundations/tokenusage/enums/tokenusage.type";
import { DriftContextState } from "../../contexts/drift.context";
import { FollowUpNodeService } from "../followup.node.service";
import { HydeNodeService } from "../hyde.node.service";
import { PrimerAnswerNodeService } from "../primer.answer.node.service";
import { SynthesisNodeService } from "../synthesis.node.service";

/**
 * DRIFT is a SUB-AGENT: the responder invokes it, and the owner's ruling is that
 * the CALLING agent records the spend. All four `llm.call` sites — and the HyDE
 * embedding Task 8 had to leave unattributed — carry the caller's ledger
 * category and the caller's entity.
 */
describe("DRIFT — inherited usage attribution", () => {
  modelRegistry.register({ nodeName: "campaign", labelName: "Campaign", type: "campaigns" } as never);

  let llmService: { call: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };
  let logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
  let embedderService: { vectoriseText: ReturnType<typeof vi.fn> };
  let communityRepository: {
    findByLevel: ReturnType<typeof vi.fn>;
    findByIds: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    llmService = {
      call: vi.fn().mockResolvedValue({
        hypotheticalAnswer: "a hypothetical answer",
        initialAnswer: "an initial answer",
        answer: "an answer",
        finalAnswer: "a final answer",
        followUpQuestions: [],
        additionalQuestions: [],
        shouldContinue: false,
        confidence: 0.5,
        tokenUsage: { input: 1, output: 1 },
      }),
    };
    configService = { get: vi.fn().mockReturnValue({}) };
    logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    embedderService = { vectoriseText: vi.fn().mockResolvedValue([0.1, 0.2]) };
    communityRepository = {
      findByLevel: vi.fn().mockResolvedValue([]),
      findByIds: vi.fn().mockResolvedValue([]),
    };
  });

  const createState = (overrides?: Partial<DriftContextState>): DriftContextState =>
    ({
      question: "Who runs the trading post?",
      topK: 5,
      maxDepth: 2,
      nextStep: "hyde",
      hops: 0,
      hypotheticalAnswer: "",
      hydeEmbedding: [],
      // Non-empty: the primer and synthesis nodes short-circuit without ever
      // reaching their `llm.call` when no community matched.
      matchedCommunities: [{ id: "community-1", summary: "a summary" }],
      communitySummaries: "summaries",
      initialAnswer: "",
      followUpQuestions: ["a follow-up?"],
      confidence: 0,
      currentFollowUpIndex: 0,
      currentDepth: 0,
      followUpAnswers: [],
      priorContext: "",
      finalAnswer: "",
      tokens: { input: 0, output: 0 },
      // The caller's attribution, seeded by DriftSearchService.search.
      tokenUsageType: TokenUsageType.Responder,
      scopeId: "campaign-1",
      scopeLabel: "Campaign",
      ...overrides,
    }) as DriftContextState;

  const nodes: { name: string; run: (state: DriftContextState) => Promise<unknown> }[] = [
    {
      name: "hyde",
      run: (state) =>
        new HydeNodeService(
          llmService as never,
          embedderService as never,
          communityRepository as never,
          logger as never,
          configService as never,
        ).execute({ state: state as never }),
    },
    {
      name: "primer_answer",
      run: (state) =>
        new PrimerAnswerNodeService(llmService as never, logger as never, configService as never).execute({
          state: state as never,
        }),
    },
    {
      name: "followup",
      run: (state) =>
        new FollowUpNodeService(
          llmService as never,
          communityRepository as never,
          logger as never,
          configService as never,
        ).execute({ state: state as never }),
    },
    {
      name: "synthesis",
      run: (state) =>
        new SynthesisNodeService(llmService as never, logger as never, configService as never).execute({
          state: state as never,
        }),
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
          expect(args.relationshipId).toBeUndefined();
          expect(args.relationshipType).toBeUndefined();
          expect(args.tokenUsageType).toBe(TokenUsageType.TextGeneration);
        }
      });
    });
  }

  describe("hyde embedding", () => {
    const runHyde = (state: DriftContextState) =>
      new HydeNodeService(
        llmService as never,
        embedderService as never,
        communityRepository as never,
        logger as never,
        configService as never,
      ).execute({ state: state as never });

    it("bills the HyDE embedding to the same entity as the HyDE completion", async () => {
      await runHyde(createState());

      expect(embedderService.vectoriseText).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: { relationshipId: "campaign-1", relationshipType: "Campaign" },
        }),
      );
    });

    it("records nothing for the embedding when the caller supplied no attribution", async () => {
      await runHyde(createState({ tokenUsageType: undefined, scopeId: undefined, scopeLabel: undefined }));

      expect(embedderService.vectoriseText).toHaveBeenCalledWith(expect.objectContaining({ attribution: undefined }));
    });
  });

  it("keeps DriftContextState constructible without the attribution keys (published type)", () => {
    // `DriftContextState` is exported from agents/index.ts, so a consumer may
    // build one as a literal. This only COMPILES if the five attribution keys
    // are optional — the regression a required LangGraph channel would cause.
    const preTask10: DriftContextState = {
      question: "q",
      topK: 5,
      maxDepth: 2,
      nextStep: "hyde",
      hops: 0,
      hypotheticalAnswer: "",
      hydeEmbedding: [],
      matchedCommunities: [],
      communitySummaries: "",
      initialAnswer: "",
      followUpQuestions: [],
      confidence: 0,
      currentFollowUpIndex: 0,
      currentDepth: 0,
      followUpAnswers: [],
      priorContext: "",
      finalAnswer: "",
      tokens: { input: 0, output: 0 },
    };

    expect(preTask10.scopeId).toBeUndefined();
  });
});
