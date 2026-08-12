import { END, START, StateGraph } from "@langchain/langgraph";
import { Injectable } from "@nestjs/common";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { TracingService } from "../../../core/tracing/services/tracing.service";
import { Community } from "../../../foundations/community/entities/community.entity";
import { DriftContext, DriftContextState, DriftGraphState, FollowUpAnswer } from "../contexts/drift.context";
import { CommunitySearchNodeService } from "../nodes/community.search.node.service";
import { FollowUpNodeService } from "../nodes/followup.node.service";
import { HydeNodeService } from "../nodes/hyde.node.service";
import { PrimerAnswerNodeService } from "../nodes/primer.answer.node.service";
import { SynthesisNodeService } from "../nodes/synthesis.node.service";
import { CallerAttributionState, classifyCallerAttribution } from "../../common/usage-attribution";

export interface DriftSearchResult {
  answer: string;
  matchedCommunities: Community[];
  followUpAnswers: FollowUpAnswer[];
  initialAnswer: string;
  confidence: number;
  hydeEmbedding: number[];
}

export interface DriftConfig {
  primerTopK?: number;
  followUpDepth?: number;
}

@Injectable()
export class DriftSearchService {
  constructor(
    private readonly hydeNode: HydeNodeService,
    private readonly communitySearchNode: CommunitySearchNodeService,
    private readonly primerAnswerNode: PrimerAnswerNodeService,
    private readonly followUpNode: FollowUpNodeService,
    private readonly synthesisNode: SynthesisNodeService,
    private readonly logger: AppLoggingService,
    private readonly tracer: TracingService,
  ) {}

  /**
   * Run full DRIFT search workflow using LangGraph StateGraph:
   * 1. HyDE: Generate hypothetical document embedding
   * 2. Community Search: Vector search against community summaries
   * 3. Primer Answer: Generate initial answer + follow-up questions
   * 4. Follow-up: Process follow-up questions iteratively
   * 5. Synthesis: Combine all answers into final response
   */
  async search(params: {
    question: string;
    config?: DriftConfig;
    /**
     * Cost attribution INHERITED from the calling agent. DRIFT is a sub-agent —
     * it bills the caller's ledger category against the caller's entity, and
     * owns neither. Optional, so existing consumers are unaffected.
     */
    attribution?: CallerAttributionState;
  }): Promise<DriftSearchResult> {
    const config = params.config ?? {};
    const maxHops = 20;

    this.logger.log(`Starting DRIFT search for: "${params.question}"`, "DriftSearchService");

    // Log proportionately — see ContextualiserService.run for the reasoning.
    // Named nothing => opting out => debug. Named something unusable => fault
    // => warn, because it looks attributed and bills nothing.
    const attributionState = classifyCallerAttribution(params.attribution);
    if (attributionState === "unresolvable") {
      this.logger.warn(
        `DRIFT search invoked with an UNRESOLVABLE cost attribution ` +
          `(scopeId=${params.attribution?.scopeId ?? "none"} scopeType=${params.attribution?.scopeType ?? "none"} ` +
          `scopeLabel=${params.attribution?.scopeLabel ?? "none"} assistantId=${params.attribution?.assistantId ?? "none"}) — ` +
          `the caller named an entity that cannot be billed, so every LLM and embedding call in this run will be unbilled.`,
        "DriftSearchService",
      );
    } else if (attributionState === "none") {
      this.logger.debug(
        `DRIFT search invoked with no cost attribution — this run's LLM and embedding spend will not be recorded.`,
        "DriftSearchService",
      );
    }

    this.tracer.startSpan("DRIFT Search Workflow", {
      attributes: {
        question: params.question,
        topK: config.primerTopK ?? 5,
        maxDepth: config.followUpDepth ?? 2,
        maxHops,
      },
    });

    const returnState = (state: DriftGraphState): string => {
      const nextStep = state.hops >= maxHops ? "synthesis" : state.nextStep;
      return nextStep === "end" ? END : nextStep;
    };

    const workflow = new StateGraph(DriftContext)
      .addNode("hyde", async (state: DriftGraphState) => {
        this.tracer.addSpanEvent(`Node: hyde - hop ${state.hops}/${maxHops}`, { hopCount: state.hops });
        const result = await this.hydeNode.execute({ state });
        this.tracer.addSpanEvent(`Node: hyde complete`, { nextStep: result.nextStep });
        return result;
      })
      .addNode("community_search", async (state: DriftGraphState) => {
        this.tracer.addSpanEvent(`Node: community_search - hop ${state.hops}/${maxHops}`, { hopCount: state.hops });
        const result = await this.communitySearchNode.execute({ state });
        this.tracer.addSpanEvent(`Node: community_search complete`, {
          communitiesFound: result.matchedCommunities?.length ?? 0,
          nextStep: result.nextStep,
        });
        return result;
      })
      .addNode("primer_answer", async (state: DriftGraphState) => {
        this.tracer.addSpanEvent(`Node: primer_answer - hop ${state.hops}/${maxHops}`, { hopCount: state.hops });
        const result = await this.primerAnswerNode.execute({ state });
        this.tracer.addSpanEvent(`Node: primer_answer complete`, {
          confidence: result.confidence,
          followUpCount: result.followUpQuestions?.length ?? 0,
          nextStep: result.nextStep,
        });
        return result;
      })
      .addNode("followup", async (state: DriftGraphState) => {
        this.tracer.addSpanEvent(`Node: followup - hop ${state.hops}/${maxHops}`, {
          hopCount: state.hops,
          questionIndex: state.currentFollowUpIndex,
          depth: state.currentDepth,
        });
        const result = await this.followUpNode.execute({ state });
        this.tracer.addSpanEvent(`Node: followup complete`, { nextStep: result.nextStep });
        return result;
      })
      .addNode("synthesis", async (state: DriftGraphState) => {
        this.tracer.addSpanEvent(`Node: synthesis - hop ${state.hops}/${maxHops} (final)`, { hopCount: state.hops });
        const result = await this.synthesisNode.execute({ state });
        this.tracer.addSpanEvent(`Node: synthesis complete`);
        return result;
      })
      .addEdge(START, "hyde")
      .addEdge("hyde", "community_search")
      .addConditionalEdges("community_search", (state: DriftGraphState) => returnState(state))
      .addConditionalEdges("primer_answer", (state: DriftGraphState) => returnState(state))
      .addConditionalEdges("followup", (state: DriftGraphState) => returnState(state))
      .addEdge("synthesis", END);

    const app = workflow.compile();

    const initialState: DriftContextState = {
      question: params.question,
      // The caller's attribution, seeded once and read by every node.
      tokenUsageType: params.attribution?.tokenUsageType,
      scopeId: params.attribution?.scopeId,
      scopeType: params.attribution?.scopeType,
      scopeLabel: params.attribution?.scopeLabel,
      assistantId: params.attribution?.assistantId,
      topK: config.primerTopK ?? 5,
      maxDepth: config.followUpDepth ?? 2,
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

    this.tracer.addSpanEvent("Workflow Executing");

    let finalState: DriftContextState;
    try {
      finalState = await app.invoke(initialState, {
        recursionLimit: maxHops + 5,
      } as any);

      this.tracer.addSpanEvent("Workflow Completed", {
        finalHopCount: finalState.hops,
        communitiesMatched: finalState.matchedCommunities.length,
        followUpAnswersCount: finalState.followUpAnswers.length,
      });

      this.tracer.setSpanSuccess();
      this.tracer.endSpan();
    } catch (e) {
      this.tracer.setSpanError(e as Error);
      this.tracer.endSpan();
      this.logger.error(`DRIFT workflow failed: ${(e as Error).message}`, "DriftSearchService");
      throw e;
    }

    this.logger.log(
      `DRIFT search complete: ${finalState.matchedCommunities.length} communities, ${finalState.followUpAnswers.length} follow-ups, ${finalState.hops} hops`,
      "DriftSearchService",
    );

    return {
      answer: finalState.finalAnswer,
      matchedCommunities: finalState.matchedCommunities,
      followUpAnswers: finalState.followUpAnswers,
      initialAnswer: finalState.initialAnswer,
      confidence: finalState.confidence,
      hydeEmbedding: finalState.hydeEmbedding,
    };
  }

  /**
   * Quick search - just HyDE + community search + primer answer (no follow-ups)
   * Useful for when you want fast results
   */
  async quickSearch(params: {
    question: string;
    topK?: number;
    /** Cost attribution INHERITED from the calling agent — see {@link search}. */
    attribution?: CallerAttributionState;
  }): Promise<DriftSearchResult> {
    return this.search({
      question: params.question,
      config: {
        primerTopK: params.topK,
        followUpDepth: 0, // Skip follow-ups
      },
      attribution: params.attribution,
    });
  }
}
