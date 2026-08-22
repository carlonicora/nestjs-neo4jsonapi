import { END, START, StateGraph } from "@langchain/langgraph";
import { Injectable, Logger } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  ContextualiserContext,
  ContextualiserContextState,
  ContextualiserGraphState,
} from "../../contextualiser/contexts/contextualiser.context";
import { ContextualiserContextFactoryService } from "../../contextualiser/factories/contextualiser.context.factory";
import { AtomicFactsNodeService } from "../../contextualiser/nodes/atomicfacts.node.service";
import { ChunkNodeService } from "../../contextualiser/nodes/chunk.node.service";
import { ChunkVectorNodeService } from "../../contextualiser/nodes/chunk.vector.node.service";
import { KeyConceptsNodeService } from "../../contextualiser/nodes/keyconcepts.node.service";
import { QuestionRefinerNodeService } from "../../contextualiser/nodes/question.refiner.node.service";
import { RationalNodeService } from "../../contextualiser/nodes/rational.node.service";
import { MessageInterface } from "../../../common/interfaces/message.interface";
import { DataLimits } from "../../../common/types/data.limits";
import { TracingService } from "../../../core/tracing/services/tracing.service";
import { MAX_LLM_CALLS_PER_RUN } from "../../../foundations/chunk/repositories/retrieval.constants";
import { CallerAttributionState, classifyCallerAttribution } from "../../common/usage-attribution";

/**
 * Picks the graph entry node for a turn.
 *
 * A fresh conversation has nothing to refine, so it goes straight to the rational
 * plan; every follow-up turn is first rewritten against the history by the
 * question refiner.
 */
export const selectInitialNode = (messagesCount: number): "rational_plan" | "question_refiner" =>
  messagesCount === 0 ? "rational_plan" : "question_refiner";

@Injectable()
export class ContextualiserService {
  private readonly logger = new Logger(ContextualiserService.name);

  constructor(
    private readonly contextualiserContextFactoryService: ContextualiserContextFactoryService,
    private readonly questionRefinedNode: QuestionRefinerNodeService,
    private readonly rationalNode: RationalNodeService,
    private readonly keyConceptsNode: KeyConceptsNodeService,
    private readonly atomicFactsNode: AtomicFactsNodeService,
    private readonly chunkNode: ChunkNodeService,
    private readonly chunkVectorNode: ChunkVectorNodeService,
    private readonly clsService: ClsService,
    private readonly tracer: TracingService,
  ) {}

  async run(params: {
    companyId: string;
    contentId: string;
    contentType: string;
    previousAnalysis?: string;
    dataLimits: DataLimits;
    messages: MessageInterface[];
    question?: string;
    /**
     * Cost attribution INHERITED from the calling agent. The contextualiser is
     * a sub-agent — it bills the caller's ledger category against the caller's
     * entity, and owns neither. Optional, so existing consumers are unaffected.
     */
    attribution?: CallerAttributionState;
  }): Promise<ContextualiserContextState> {
    // Supersteps, not spend. LangGraph needs an absolute ceiling so a routing
    // bug cannot loop forever; the SPEND bound is MAX_LLM_CALLS_PER_RUN below.
    const maxSupersteps = 20;

    // Log proportionately. A caller that named NOTHING is opting out — MCP tool
    // calls do this on every single request and are right to — so it gets a
    // debug line, not a warning. A caller that named something unusable is a
    // fault: it looks attributed and bills nothing, and that must be loud.
    const attributionState = classifyCallerAttribution(params.attribution);
    if (attributionState === "unresolvable") {
      this.logger.warn(
        `contextualiser invoked with an UNRESOLVABLE cost attribution ` +
          `(scopeId=${params.attribution?.scopeId ?? "none"} scopeType=${params.attribution?.scopeType ?? "none"} ` +
          `scopeLabel=${params.attribution?.scopeLabel ?? "none"} assistantId=${params.attribution?.assistantId ?? "none"}) — ` +
          `the caller named an entity that cannot be billed, so every LLM call in this run will be unbilled.`,
      );
    } else if (attributionState === "none") {
      this.logger.debug(`contextualiser invoked with no cost attribution — this run's LLM spend will not be recorded.`);
    }

    const mainPrompt: string | undefined = undefined;
    const finalPrompt: string | undefined = undefined;

    const initial = selectInitialNode(params.messages.length);

    this.logger.log(
      `contextualiser START question="${params.question ?? "<from history>"}" ` +
        `initial=${initial} messages=${params.messages.length} ` +
        `howToMode=${!!params.dataLimits.howToMode} ` +
        `limitToHowToId=${params.dataLimits.limitToHowToId ?? "none"} ` +
        `contentType=${params.contentType ?? "none"}`,
    );

    this.tracer.startSpan("Contextualiser Workflow", {
      attributes: {
        companyId: params.companyId,
        contentId: params.contentId,
        contentType: params.contentType,
        messagesCount: params.messages.length,
        question: params.question ?? "none",
        maxSupersteps: maxSupersteps,
        recursionLimit: maxSupersteps + 2,
        initialNode: initial,
      },
    });

    const returnState = (params: { state: ContextualiserContextState; forceNextStep?: string }): string => {
      if (params.state.status.length) {
        this.clsService.set("ragStatus", `${params.state.status.join("\n\n")}`);
      }
      const nextStep = params.forceNextStep ?? params.state.nextStep;
      // The budget is on PROVIDER CALLS. `hops` counts nodes and three of them
      // advance it by two, so it was never a spend bound.
      const budgetSpent = (params.state.llmCalls ?? 0) >= MAX_LLM_CALLS_PER_RUN;
      if (budgetSpent) {
        this.logger.warn(
          `contextualiser call budget spent (${params.state.llmCalls}/${MAX_LLM_CALLS_PER_RUN}) — routing to answer`,
        );
      }
      return budgetSpent ? "answer" : nextStep;
    };

    const workflow = new StateGraph(ContextualiserContext)
      .addNode("question_refiner", async (state: ContextualiserGraphState) => {
        this.tracer.addSpanEvent(
          `Node: question_refiner - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            hopCount: state.hops,
          },
        );
        const result = await this.questionRefinedNode.execute({ state: state });
        this.tracer.addSpanEvent(
          `Node: question_refiner complete - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            nextStep: result.nextStep,
          },
        );
        return result;
      })
      .addNode("rational_plan", async (state: ContextualiserGraphState) => {
        this.tracer.addSpanEvent(
          `Node: rational_plan - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            hopCount: state.hops,
          },
        );
        const result = await this.rationalNode.execute({ state: state });
        this.tracer.addSpanEvent(
          `Node: rational_plan complete - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            nextStep: result.nextStep,
          },
        );
        return result;
      })
      .addNode("key_concepts", async (state: ContextualiserGraphState) => {
        this.tracer.addSpanEvent(
          `Node: key_concepts - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            hopCount: state.hops,
          },
        );
        const result = await this.keyConceptsNode.execute({
          state: state,
        });
        this.tracer.addSpanEvent(
          `Node: key_concepts complete - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            nextStep: result.nextStep,
          },
        );
        return result;
      })
      .addNode("atomic_facts", async (state: ContextualiserGraphState) => {
        this.tracer.addSpanEvent(
          `Node: atomic_facts - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            hopCount: state.hops,
          },
        );
        const result = await this.atomicFactsNode.execute({
          state: state,
        });
        this.tracer.addSpanEvent(
          `Node: atomic_facts complete - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            nextStep: result.nextStep,
          },
        );
        return result;
      })
      .addNode("chunk_vector", async (state: ContextualiserGraphState) => {
        this.tracer.addSpanEvent(
          `Node: chunk_vector - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            hopCount: state.hops,
          },
        );
        const result = await this.chunkVectorNode.execute({ state });
        this.tracer.addSpanEvent(
          `Node: chunk_vector complete - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
        );
        return result;
      })
      .addNode("chunks", async (state: ContextualiserGraphState) => {
        this.tracer.addSpanEvent(
          `Node: chunks - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            hopCount: state.hops,
          },
        );
        const result = await this.chunkNode.execute({
          state: state,
        });
        this.tracer.addSpanEvent(
          `Node: chunks complete - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            nextStep: result.nextStep,
          },
        );
        return result;
      })
      .addNode("neighbouring_nodes", async (state: ContextualiserGraphState) => {
        this.tracer.addSpanEvent(
          `Node: neighbouring_nodes - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            hopCount: state.hops,
          },
        );
        const result = await this.keyConceptsNode.execute({
          state: state,
        });
        this.tracer.addSpanEvent(
          `Node: neighbouring_nodes complete - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN}`,
          {
            nextStep: result.nextStep,
          },
        );
        return result;
      })
      .addNode("answer", (state: ContextualiserGraphState) => {
        this.tracer.addSpanEvent(
          `Node: answer - hop ${state.hops} calls ${state.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN} (final)`,
          {
            hopCount: state.hops,
          },
        );
        return { ...state, tokens: { input: 0, output: 0 } };
      })
      .addEdge(START, initial)
      .addEdge("question_refiner", "rational_plan")
      .addEdge("rational_plan", "chunk_vector")
      .addConditionalEdges("chunk_vector", (state: ContextualiserGraphState) => returnState({ state }))
      .addConditionalEdges("key_concepts", (state: ContextualiserGraphState) =>
        returnState({ state: state, forceNextStep: "atomic_facts" }),
      )
      .addConditionalEdges("atomic_facts", (state: ContextualiserGraphState) => returnState({ state }))
      .addConditionalEdges("neighbouring_nodes", (state: ContextualiserGraphState) =>
        returnState({ state: state, forceNextStep: "atomic_facts" }),
      )
      .addConditionalEdges("chunks", (state: ContextualiserGraphState) => returnState({ state }))
      .addEdge("answer", END);

    const app = workflow.compile();

    const initialState: ContextualiserContextState = this.contextualiserContextFactoryService.create({
      companyId: params.companyId,
      contentId: params.contentId,
      contentType: params.contentType,
      dataLimits: params.dataLimits,
      question: params.question,
      mainPrompt: mainPrompt,
      finalPrompt: finalPrompt,
      previousMessages: params.messages,
      preselectedChunks: [],
      attribution: params.attribution,
    });

    this.tracer.addSpanEvent("Workflow Executing");

    const stepCount = 0;
    let finalState: ContextualiserContextState;

    try {
      finalState = await app.invoke(initialState, {
        recursionLimit: maxSupersteps + 2,
      } as any);

      this.tracer.addSpanEvent("Workflow Completed", {
        finalHopCount: finalState.hops,
        totalSteps: stepCount,
      });

      this.logger.log(
        `contextualiser END hops=${finalState.hops} calls=${finalState.llmCalls ?? 0}/${MAX_LLM_CALLS_PER_RUN} ` +
          `processedKeyConcepts=${finalState.processedKeyConcepts?.length ?? 0} ` +
          `processedAtomicFacts=${finalState.processedAtomicFacts?.length ?? 0} ` +
          `processedChunks=${finalState.processedChunks?.length ?? 0} ` +
          `notebook=${finalState.notebook?.length ?? 0} entries`,
      );

      this.tracer.setSpanSuccess();
      this.tracer.endSpan();
    } catch (e) {
      this.tracer.setSpanError(e as Error);
      this.tracer.endSpan();
      throw e;
    }

    return finalState;
  }
}
