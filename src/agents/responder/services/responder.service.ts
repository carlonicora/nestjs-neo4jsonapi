import { END, START, StateGraph } from "@langchain/langgraph";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigResponderInterface } from "../../../config/interfaces/config.responder.interface";
import { ContextualiserService } from "../../contextualiser/services/contextualiser.service";
import { DriftSearchService } from "../../drift/services/drift.search.service";
import { ResponderContext, ResponderContextState } from "../contexts/responder.context";
import { ResponderContextFactoryService } from "../factories/responder.context.factory";
import { ResponderResponseInterface } from "../interfaces/responder.response.interface";
import { ResponderAnswerNodeService } from "../nodes/responder.answer.node.service";
import { PlannerNodeService } from "../nodes/planner.node.service";
import { GraphNodeService } from "../nodes/graph.node.service";
import { MessageInterface } from "../../../common/interfaces/message.interface";
import type { AssistantSeedContext } from "../../../common/interfaces/seed.context.interface";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { DataLimits } from "../../../common/types/data.limits";
import { TokenUsageType } from "../../../foundations/tokenusage/enums/tokenusage.type";
import { CallerAttributionState, buildCallerAttribution } from "../../common/usage-attribution";

export interface BranchToggles {
  graph?: boolean;
  contextualiser?: boolean;
  drift?: boolean;
}

/**
 * Composes the deployment-wide branch toggles (`responder.branches` in config)
 * with the per-call toggles passed to `run()`. A branch is allowed only when
 * BOTH say so — either side switching it off wins. Both default to `true`.
 */
export const resolveAllowedBranches = (config?: BranchToggles, perCall?: BranchToggles) => ({
  graph: (config?.graph ?? true) && (perCall?.graph ?? true),
  contextualiser: (config?.contextualiser ?? true) && (perCall?.contextualiser ?? true),
  drift: (config?.drift ?? true) && (perCall?.drift ?? true),
});

@Injectable()
export class ResponderService {
  private readonly logger = new Logger(ResponderService.name);

  constructor(
    private readonly factory: ResponderContextFactoryService,
    private readonly contextualiserService: ContextualiserService,
    private readonly driftSearchService: DriftSearchService,
    private readonly answerNode: ResponderAnswerNodeService,
    private readonly plannerNode: PlannerNodeService,
    private readonly graphNode: GraphNodeService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  async run(params: {
    companyId: string;
    userId: string;
    userModuleIds: string[];
    contentId?: string;
    contentType?: string;
    dataLimits: DataLimits;
    messages: MessageInterface[];
    question?: string;
    branches?: BranchToggles;
    /** Id of the scope-root node the whole run is confined to. Absent = unscoped. */
    scopeId?: string;
    /** JSON:API type of the scope root, e.g. "campaigns". Present iff scopeId is. */
    scopeType?: string;
    /** Neo4j label of the scope root, e.g. "Campaign". Present iff scopeId is. */
    scopeLabel?: string;
    /** Id of the `Assistant` (thread) node — the cost-attribution fallback for an unscoped turn. */
    assistantId?: string;
    /** App-provided context blocks guaranteed present this turn. */
    seedContexts?: AssistantSeedContext[];
  }): Promise<ResponderResponseInterface> {
    const allowed = resolveAllowedBranches(
      this.configService.get<ConfigResponderInterface>("responder")?.branches,
      params.branches,
    );

    const lastUserMessage =
      params.question ?? [...params.messages].reverse().find((m) => m.type === AgentMessageType.User)?.content ?? "";

    const initialState = this.factory.create({
      companyId: params.companyId,
      contentId: params.contentId,
      contentType: params.contentType,
      dataLimits: params.dataLimits,
      scopeId: params.scopeId,
      scopeType: params.scopeType,
      scopeLabel: params.scopeLabel,
      assistantId: params.assistantId,
    });
    initialState.userId = params.userId;
    initialState.userModuleIds = params.userModuleIds;
    initialState.chatHistory = params.messages;
    initialState.rawQuestion = lastUserMessage;
    initialState.question = lastUserMessage;
    initialState.seedContexts = params.seedContexts;

    const useHowToBranch = !!params.dataLimits.howToMode || !!params.dataLimits.limitToHowToId;

    // Help-mode skips the planner node, so state.branchPlan stays undefined.
    // The answer node reads branchPlan to decide which sections to include —
    // when undefined it falls back to all-false → notebookSection="" → the LLM
    // gets no chunks and replies "no information available". Pre-set the plan
    // here so the help-mode answer node uses the contextualiser's output.
    if (useHowToBranch) {
      initialState.branchPlan = {
        runGraph: false,
        runContextualiser: true,
        runDrift: false,
        reasoning: "help-mode: contextualiser-only retrieval over HowTo chunks",
      };
    }

    const workflow = new StateGraph(ResponderContext)
      .addNode("contextualiser", async (state) => {
        try {
          const ctx = await this.contextualiserService.run({
            companyId: state.companyId,
            contentId: state.contentId ?? "",
            contentType: state.contentType ?? "",
            dataLimits: params.dataLimits,
            messages: params.messages,
            question: state.question,
            // The contextualiser is a sub-agent: its spend is the RESPONDER's
            // spend, billed to the responder's category against the responder's
            // entity. It invents neither.
            attribution: this.attribution(state),
          });
          return {
            context: ctx,
            tokens: ctx.tokens,
            trace: {
              contextualiser: {
                hops: ctx.hops,
                chunksProcessed: ctx.processedChunks?.length ?? 0,
                status: "success" as const,
                tokens: ctx.tokens,
              },
            } as any,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`contextualiser failed: ${message}`);
          return {
            contextualiserError: message,
            trace: {
              contextualiser: {
                hops: 0,
                chunksProcessed: 0,
                status: "failed" as const,
                errorMessage: message,
                tokens: { input: 0, output: 0 },
              },
            } as any,
          };
        }
      })
      .addNode("answer", async (state) => this.answerNode.execute({ state }));

    if (useHowToBranch) {
      workflow.addEdge(START, "contextualiser").addEdge("contextualiser", "answer").addEdge("answer", END);
    } else {
      workflow
        .addNode("planner", async (state) => {
          const result = await this.plannerNode.execute({ state });
          const plan = result.branchPlan;
          if (!plan) return result;

          const plannerPickedSomething = plan.runGraph || plan.runContextualiser || plan.runDrift;
          const masked = {
            ...plan,
            runGraph: plan.runGraph && allowed.graph,
            runContextualiser: plan.runContextualiser && allowed.contextualiser,
            runDrift: plan.runDrift && allowed.drift,
          };
          // Never mask into a dead end: if the planner picked branches but the
          // toggles switched every one of them off, fall back to the
          // contextualiser when it is allowed (mirrors the planner-error fallback).
          // A planner that picked nothing at all is left alone — the conditional
          // edge already routes that case straight to the answer node.
          if (
            plannerPickedSomething &&
            !masked.runGraph &&
            !masked.runContextualiser &&
            !masked.runDrift &&
            allowed.contextualiser
          ) {
            masked.runContextualiser = true;
          }

          // Keep the trace honest: `trace.planner.branchPlan` must describe what
          // actually ran, so it carries the masked plan. The planner's original
          // pick is preserved beside it as `rawBranchPlan`, and only when the
          // toggles actually changed something.
          const wasMasked =
            masked.runGraph !== plan.runGraph ||
            masked.runContextualiser !== plan.runContextualiser ||
            masked.runDrift !== plan.runDrift;

          const trace = result.trace
            ? {
                ...result.trace,
                planner: {
                  ...result.trace.planner,
                  branchPlan: masked,
                  ...(wasMasked ? { rawBranchPlan: plan } : {}),
                },
              }
            : result.trace;

          return { ...result, branchPlan: masked, trace };
        })
        .addNode("graph", async (state) => this.graphNode.execute({ state }))
        .addNode("drift", async (state) => {
          try {
            const result = await this.driftSearchService.search({
              question: state.question,
              // Same rule as the contextualiser above: DRIFT's spend is the
              // responder's spend.
              attribution: this.attribution(state),
            });
            return {
              driftContext: result,
              // DRIFT's spend goes into the ADDITIVE `tokens` channel as well as
              // the trace. Trace-only reporting is what left the turn total
              // short of the per-node sum (see planner.node.service.ts).
              tokens: (result as any).tokens ?? { input: 0, output: 0 },
              trace: {
                drift: {
                  confidence: result.confidence ?? 0,
                  communitiesMatched: result.matchedCommunities?.length ?? 0,
                  status: "success" as const,
                  tokens: (result as any).tokens ?? { input: 0, output: 0 },
                },
              } as any,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`drift failed: ${message}`);
            return {
              driftError: message,
              trace: {
                drift: {
                  confidence: 0,
                  communitiesMatched: 0,
                  status: "failed" as const,
                  errorMessage: message,
                  tokens: { input: 0, output: 0 },
                },
              } as any,
            };
          }
        })
        .addEdge(START, "planner")
        .addConditionalEdges(
          "planner",
          (state) => {
            const picks: string[] = [];
            if (state.branchPlan?.runGraph) picks.push("graph");
            if (state.branchPlan?.runContextualiser) picks.push("contextualiser");
            if (state.branchPlan?.runDrift) picks.push("drift");
            return picks.length ? picks : ["answer"];
          },
          ["graph", "contextualiser", "drift", "answer"],
        )
        .addEdge("graph", "answer")
        .addEdge("contextualiser", "answer")
        .addEdge("drift", "answer")
        .addEdge("answer", END);
    }

    const app = workflow.compile();
    const finalState = (await app.invoke(initialState, {
      recursionLimit: 100,
    } as any)) as ResponderContextState;

    return this.factory.createAnswer({ state: finalState });
  }

  /**
   * The attribution the responder hands DOWN to the sub-agents it invokes.
   *
   * `tokenUsageType` is the responder's own — the owner's ruling is that the
   * agent that CALLS a sub-agent is the agent that records its usage, so the
   * ledger shows one category per turn instead of one per internal component.
   * The scope triple is passed through untranslated: `scopeLabel` is already the
   * Neo4j label, and `scopeType` is only ever the registry's fallback input —
   * neither is ever written into Cypher as a label without going through
   * `buildScopeAttribution` first.
   */
  private attribution(state: ResponderContextState): CallerAttributionState {
    return buildCallerAttribution({ tokenUsageType: TokenUsageType.Responder, source: state });
  }
}
