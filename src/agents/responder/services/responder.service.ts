import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ContextualiserService } from "../../contextualiser/services/contextualiser.service";
import { DriftSearchService } from "../../drift/services/drift.search.service";
import { ResponderContext, ResponderContextState } from "../contexts/responder.context";
import { ResponderContextFactoryService } from "../factories/responder.context.factory";
import { ResponderResponseInterface } from "../interfaces/responder.response.interface";
import { ResponderAnswerNodeService } from "../nodes/responder.answer.node.service";
import { PlannerNodeService } from "../nodes/planner.node.service";
import { GraphNodeService } from "../nodes/graph.node.service";
import { MessageInterface } from "../../../common/interfaces/message.interface";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { DataLimits } from "../../../common/types/data.limits";

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
  }): Promise<ResponderResponseInterface> {
    const lastUserMessage =
      params.question ?? [...params.messages].reverse().find((m) => m.type === AgentMessageType.User)?.content ?? "";

    const initialState = this.factory.create({
      companyId: params.companyId,
      contentId: params.contentId,
      contentType: params.contentType,
      dataLimits: params.dataLimits,
    });
    initialState.userId = params.userId;
    initialState.userModuleIds = params.userModuleIds;
    initialState.chatHistory = params.messages;
    initialState.rawQuestion = lastUserMessage;
    initialState.question = lastUserMessage;

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
        .addNode("planner", async (state) => this.plannerNode.execute({ state }))
        .addNode("graph", async (state) => this.graphNode.execute({ state }))
        .addNode("drift", async (state) => {
          try {
            const result = await this.driftSearchService.search({ question: state.question });
            return {
              driftContext: result,
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

    const threadId = randomUUID();
    const app = workflow.compile({ checkpointer: new MemorySaver() });
    const finalState = (await app.invoke(initialState, {
      configurable: { thread_id: threadId },
      recursionLimit: 100,
    } as any)) as ResponderContextState;

    return this.factory.createAnswer({ state: finalState });
  }
}
