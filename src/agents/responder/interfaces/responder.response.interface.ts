import type { ContextualiserResponseInterface } from "../../contextualiser/interfaces/contextualiser.response.interface";
import type { GraphNodeOutput } from "../../graph/interfaces/graph.node.output.interface";
import type { DriftSearchResult } from "../../drift/services/drift.search.service";
import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { TokenUsageInterface } from "../../../common/interfaces/token.usage.interface";
import type { EntityReference } from "./entity.reference.interface";
import type { UnifiedTrace } from "./unified.trace.interface";

export interface ResponderResponseInterface {
  type: AgentMessageType;
  context: ContextualiserResponseInterface;
  graphContext?: GraphNodeOutput;
  driftContext?: DriftSearchResult;
  answer: {
    title: string;
    analysis: string;
    answer: string;
    questions: string[];
    hasAnswer: boolean;
  };
  sources: { chunkId: string; relevance: number; reason: string }[];
  references: EntityReference[];
  ontologies: string[];
  trace: UnifiedTrace;
  tokens: TokenUsageInterface;
}
