import { AgentMessageType } from "../../../common/enums/agentmessage.type";
import { TokenUsageInterface } from "../../../common/interfaces/token.usage.interface";
import { NotebookContext } from "../contexts/notebook.context";

export interface ContextualiserResponseInterface {
  type: AgentMessageType;
  rationalPlan: string;
  annotations: string;
  // The notebook entries carried verbatim from the graph state — including
  // `sourceLayer` / `metadata`, which the responder backfills onto its sources.
  notebook: (typeof NotebookContext.State)[];
  processedElements: {
    keyConcepts: string[];
    atomicFacts: string[];
    chunks: string[];
  };
  sources: {
    chunkId: string;
    relevance: number;
  }[];
  requests: {
    message: string;
    rawResponse: any;
  }[];
  tokens: TokenUsageInterface;
}
