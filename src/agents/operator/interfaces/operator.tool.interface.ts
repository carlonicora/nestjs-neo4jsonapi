import { DynamicStructuredTool } from "@langchain/core/tools";
import { MessageInterface } from "../../../common/interfaces/message.interface";
import { DataLimits } from "../../../common/types/data.limits";
import { ToolCallRecord, UserContext } from "../../graph/tools/tool.factory";

export interface OperatorToolDefinition {
  tool: DynamicStructuredTool;
  destructive: boolean;
  /** Human-readable line shown in the approval card. Required when destructive. */
  summarise?: (args: Record<string, unknown>) => string;
}

/** Chunk citation pushed into the per-turn recorder by retrieval tools. */
export interface OperatorChunkCitation {
  chunkId: string;
  relevance: number;
}

/**
 * ToolCallRecord extended with the chunk citations a retrieval tool collected.
 * Kept additive (operator-local) so the graph tools' recorder type is untouched.
 */
export interface OperatorToolCallRecord extends ToolCallRecord {
  citations?: OperatorChunkCitation[];
}

/** Per-turn context the operator retrieval tools are built with. */
export interface OperatorRetrievalContext extends UserContext {
  contentId?: string;
  contentType?: string;
  dataLimits: DataLimits;
  messages: MessageInterface[];
}

/**
 * Factory contract for app-contributed operator tools.
 * Built once per operator turn — like the built-ins — so contributed tools can
 * apply company scoping from the request context and record their calls into
 * the per-turn toolCalls audit trail.
 */
export interface OperatorToolContribution {
  /** Called once per operator turn with the request context and the per-turn tool-call recorder. */
  build(ctx: OperatorRetrievalContext, recorder: ToolCallRecord[]): OperatorToolDefinition;
}

/** Multi-provider DI token: consuming apps contribute OperatorToolContribution factories. */
export const OPERATOR_TOOLS = Symbol("OPERATOR_TOOLS");
