import { Injectable } from "@nestjs/common";
import { ContextualiserContextFactoryService } from "../../contextualiser/factories/contextualiser.context.factory";
import { ResponderContextState } from "../contexts/responder.context";
import { ResponderResponseInterface } from "../interfaces/responder.response.interface";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { DataLimits } from "../../../common/types/data.limits";

@Injectable()
export class ResponderContextFactoryService {
  constructor(private readonly contextualiserContextFactoryService: ContextualiserContextFactoryService) {}

  create(params: {
    companyId: string;
    contentId?: string;
    contentType?: string;
    dataLimits: DataLimits;
  }): ResponderContextState {
    return {
      companyId: params.companyId,
      contentId: params.contentId,
      contentType: params.contentType,
      dataLimits: params.dataLimits,
      driftContext: undefined,
      context: undefined,
      tokens: undefined,
      finalAnswer: undefined,
      sources: undefined,
      ontologies: undefined,
    } as ResponderContextState;
  }

  createAnswer(params: { state: ResponderContextState }): ResponderResponseInterface {
    const s = params.state;
    return {
      type: AgentMessageType.Assistant,
      context: s.context
        ? this.contextualiserContextFactoryService.createAnswer({ state: s.context })
        : {
            type: AgentMessageType.Assistant,
            rationalPlan: "",
            annotations: "",
            notebook: [],
            processedElements: { chunks: [], keyConcepts: [], atomicFacts: [] },
            sources: [],
            requests: [],
            tokens: { input: 0, output: 0 },
          },
      graphContext: s.graphContext,
      driftContext: s.driftContext,
      answer: s.finalAnswer ?? {
        title: "",
        analysis: "",
        answer: "",
        questions: [],
        hasAnswer: false,
      },
      sources: s.sources ?? [],
      references: s.references ?? [],
      ontologies: s.ontologies ?? [],
      trace: s.trace,
      tokens: s.tokens ?? { input: 0, output: 0 },
    };
  }
}
