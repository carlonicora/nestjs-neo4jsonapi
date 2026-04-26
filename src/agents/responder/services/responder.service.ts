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

    const workflow = new StateGraph(ResponderContext)
      .addNode("planner", async (state) => this.plannerNode.execute({ state }))
      .addNode("graph", async (state) => this.graphNode.execute({ state }))
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
      .addNode("answer", async (state) => this.answerNode.execute({ state }))
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

    const threadId = randomUUID();
    const app = workflow.compile({ checkpointer: new MemorySaver() });
    const finalState = (await app.invoke(initialState, {
      configurable: { thread_id: threadId },
      recursionLimit: 100,
    } as any)) as ResponderContextState;

    return this.factory.createAnswer({ state: finalState });
  }
}
