import { DynamicStructuredTool } from "@langchain/core/tools";
import { MessageInterface } from "../../../common/interfaces/message.interface";
import { DataLimits } from "../../../common/types/data.limits";
import { ToolCallRecord, UserContext } from "../../graph/tools/tool.factory";

/**
 * One referenced record, resolved to a display name.
 *
 * `id` exists for React keys only and must NEVER be rendered: the approval card
 * shows names, never ids.
 */
export interface ProposalRef {
  id: string;
  /** JSON:API type, e.g. "npcs". */
  type: string;
  /** Display name; `"(not found)"` when the id is unknown or out of scope. */
  label: string;
}

/**
 * Name-resolved description of a pending write, stored on the AssistantAction as
 * a JSON string and rendered by the approval card. `toolArgs` stays the raw
 * audit copy and is no longer used for display.
 */
// A type alias, not an interface: only an alias gets TypeScript's implicit index
// signature, which is what lets a proposal satisfy the hook's
// `Record<string, unknown>` return without a cast.
export type OperatorActionProposal = {
  /** JSON:API type of the record being written. */
  type: string;
  /** update / delete / link / unlink: the target record's name. Absent on create. */
  target?: ProposalRef;
  /** create / update: the field values being written (raw, as the tool received them). */
  attributes?: Record<string, unknown>;
  /** create: related records, resolved. The scope relationship (e.g. campaign) is STRIPPED here. */
  relationships?: Record<string, ProposalRef[]>;
  /** link / unlink: the relationship name. */
  relationship?: string;
  /** link / unlink: the resolved targets. */
  targets?: ProposalRef[];
};

export interface OperatorToolDefinition {
  tool: DynamicStructuredTool;
  destructive: boolean;
  /** Human-readable line shown in the approval card. Required when destructive. */
  summarise?: (args: Record<string, unknown>) => string | Promise<string>;
  /**
   * Structured, name-resolved rendering of the pending write for the approval
   * card — an `OperatorActionProposal`. Optional: a tool without it (or one that
   * fails) simply produces no proposal and never blocks the approval.
   */
  present?: (args: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;
  /**
   * Pre-flight check, run BEFORE the approval interrupt. A non-null string is
   * returned to the model as a tool error and no approval is requested; `null`
   * lets the approval go ahead.
   *
   * Without it an invalid call is only refused when it executes — AFTER the user
   * approved it — so the user approves an action and nothing is written. It must
   * run the same checks the execution path runs and write nothing itself.
   */
  validate?: (args: Record<string, unknown>) => Promise<string | null>;
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
  /**
   * Id of the `Assistant` (thread) node this turn belongs to. `UserContext`
   * already carries the scope triple; this completes the attribution the
   * retrieval tools hand DOWN to the contextualiser / DRIFT, which bill their
   * caller. Optional — an absent one falls back to the scope root, and an
   * absent scope root means the sub-agent's spend is not recorded.
   */
  assistantId?: string;
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
