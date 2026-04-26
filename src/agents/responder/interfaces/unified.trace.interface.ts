// packages/nestjs-neo4jsonapi/src/agents/responder/interfaces/unified.trace.interface.ts
import type { ToolCallRecord } from "../../graph/tools/tool.factory";
import type { GraphNodeOutput } from "../../graph/interfaces/graph.node.output.interface";

export interface UnifiedTrace {
  planner: {
    reasoning: string;
    branchPlan: { runGraph: boolean; runContextualiser: boolean; runDrift: boolean };
    tokens: { input: number; output: number };
  };
  graph?: {
    toolCalls: ToolCallRecord[];
    entitiesDiscovered: number;
    status: GraphNodeOutput["status"];
    errorMessage?: string;
    tokens: { input: number; output: number };
  };
  contextualiser?: {
    hops: number;
    chunksProcessed: number;
    status: "success" | "failed";
    errorMessage?: string;
    tokens: { input: number; output: number };
  };
  drift?: {
    confidence: number;
    communitiesMatched: number;
    status: "success" | "failed";
    errorMessage?: string;
    tokens: { input: number; output: number };
  };
  answer: {
    branchesUsed: ("graph" | "contextualiser" | "drift")[];
    tokens: { input: number; output: number };
  };
  totalTokens: { input: number; output: number };
}
