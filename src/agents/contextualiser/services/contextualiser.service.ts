import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import {
  ContextualiserContext,
  ContextualiserContextState,
} from "../../contextualiser/contexts/contextualiser.context";
import { ContextualiserContextFactoryService } from "../../contextualiser/factories/contextualiser.context.factory";
import { AtomicFactsNodeService } from "../../contextualiser/nodes/atomicfacts.node.service";
import { ChunkNodeService } from "../../contextualiser/nodes/chunk.node.service";
import { KeyConceptsNodeService } from "../../contextualiser/nodes/keyconcepts.node.service";
import { QuestionRefinerNodeService } from "../../contextualiser/nodes/question.refiner.node.service";
import { RationalNodeService } from "../../contextualiser/nodes/rational.node.service";
import { MessageInterface } from "../../../common/interfaces/message.interface";
import { DataLimits } from "../../../common/types/data.limits";
import { TracingService } from "../../../core/tracing/services/tracing.service";

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
  }): Promise<ContextualiserContextState> {
    const maxHops = 20;

    const mainPrompt: string | undefined = undefined;
    const finalPrompt: string | undefined = undefined;

    const initial = params.messages.length === 0 ? "question_refiner" : "rational_plan";

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
        maxHops: maxHops,
        recursionLimit: maxHops + 2,
        initialNode: initial,
      },
    });

    const returnState = (params: { state: ContextualiserContextState; forceNextStep?: string }): string => {
      if (params.state.status.length) {
        this.clsService.set("ragStatus", `${params.state.status.join("\n\n")}`);
      }
      const nextStep = params.forceNextStep ?? params.state.nextStep;
      const finalNextStep = params.state.hops === maxHops ? "answer" : nextStep;

      return finalNextStep;
    };

    const workflow = new StateGraph(ContextualiserContext)
      .addNode("question_refiner", async (state: ContextualiserContextState) => {
        this.tracer.addSpanEvent(`Node: question_refiner - hop ${state.hops}/${maxHops}`, {
          hopCount: state.hops,
        });
        const result = await this.questionRefinedNode.execute({ state: state });
        this.tracer.addSpanEvent(`Node: question_refiner complete - hop ${state.hops}/${maxHops}`, {
          nextStep: result.nextStep,
        });
        return result;
      })
      .addNode("rational_plan", async (state: ContextualiserContextState) => {
        this.tracer.addSpanEvent(`Node: rational_plan - hop ${state.hops}/${maxHops}`, {
          hopCount: state.hops,
        });
        const result = await this.rationalNode.execute({ state: state });
        this.tracer.addSpanEvent(`Node: rational_plan complete - hop ${state.hops}/${maxHops}`, {
          nextStep: result.nextStep,
        });
        return result;
      })
      .addNode("key_concepts", async (state: ContextualiserContextState) => {
        this.tracer.addSpanEvent(`Node: key_concepts - hop ${state.hops}/${maxHops}`, {
          hopCount: state.hops,
        });
        const result = await this.keyConceptsNode.execute({
          state: state,
        });
        this.tracer.addSpanEvent(`Node: key_concepts complete - hop ${state.hops}/${maxHops}`, {
          nextStep: result.nextStep,
        });
        return result;
      })
      .addNode("atomic_facts", async (state: ContextualiserContextState) => {
        this.tracer.addSpanEvent(`Node: atomic_facts - hop ${state.hops}/${maxHops}`, {
          hopCount: state.hops,
        });
        const result = await this.atomicFactsNode.execute({
          state: state,
        });
        this.tracer.addSpanEvent(`Node: atomic_facts complete - hop ${state.hops}/${maxHops}`, {
          nextStep: result.nextStep,
        });
        return result;
      })
      .addNode("chunks", async (state: ContextualiserContextState) => {
        this.tracer.addSpanEvent(`Node: chunks - hop ${state.hops}/${maxHops}`, {
          hopCount: state.hops,
        });
        const result = await this.chunkNode.execute({
          state: state,
        });
        this.tracer.addSpanEvent(`Node: chunks complete - hop ${state.hops}/${maxHops}`, {
          nextStep: result.nextStep,
        });
        return result;
      })
      .addNode("neighbouring_nodes", async (state: ContextualiserContextState) => {
        this.tracer.addSpanEvent(`Node: neighbouring_nodes - hop ${state.hops}/${maxHops}`, {
          hopCount: state.hops,
        });
        const result = await this.keyConceptsNode.execute({
          state: state,
        });
        this.tracer.addSpanEvent(`Node: neighbouring_nodes complete - hop ${state.hops}/${maxHops}`, {
          nextStep: result.nextStep,
        });
        return result;
      })
      .addNode("answer", (state: ContextualiserContextState) => {
        this.tracer.addSpanEvent(`Node: answer - hop ${state.hops}/${maxHops} (final)`, {
          hopCount: state.hops,
        });
        return { ...state, tokens: { input: 0, output: 0 } };
      })
      .addEdge(START, initial)
      .addEdge("question_refiner", "rational_plan")
      .addConditionalEdges("rational_plan", (state: ContextualiserContextState) => returnState({ state }))
      .addConditionalEdges("key_concepts", (state: ContextualiserContextState) =>
        returnState({ state: state, forceNextStep: "atomic_facts" }),
      )
      .addConditionalEdges("atomic_facts", (state: ContextualiserContextState) => returnState({ state }))
      .addConditionalEdges("neighbouring_nodes", (state: ContextualiserContextState) =>
        returnState({ state: state, forceNextStep: "atomic_facts" }),
      )
      .addConditionalEdges("chunks", (state: ContextualiserContextState) => returnState({ state }))
      .addEdge("answer", END);

    const threadId = randomUUID();
    const checkpointer = new MemorySaver();
    const app = workflow.compile({ checkpointer: checkpointer });

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
    });

    this.tracer.addSpanEvent("Workflow Executing");

    const stepCount = 0;
    let finalState: ContextualiserContextState;

    try {
      finalState = await app.invoke(initialState, {
        configurable: { thread_id: threadId },
        recursionLimit: maxHops + 2,
      } as any);

      this.tracer.addSpanEvent("Workflow Completed", {
        finalHopCount: finalState.hops,
        totalSteps: stepCount,
      });

      this.logger.log(
        `contextualiser END hops=${finalState.hops}/${maxHops} ` +
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
