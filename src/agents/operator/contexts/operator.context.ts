import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { CallerAttributionState } from "../../common/usage-attribution";
import type { ToolCallRecord } from "../../graph/tools/tool.factory";
import type { EntityReference } from "../../responder/interfaces/entity.reference.interface";

export type OperatorCitation = { chunkId: string; relevance: number; reason: string };
export type OperatorFinalAnswer = { answer: string; questions: string[] };

export const OperatorContext = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  companyId: Annotation<string>,
  userId: Annotation<string>,
  userModuleIds: Annotation<string[]>,
  contentId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  contentType: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  /** Id of the scope-root node the whole run is confined to. Absent = unscoped. */
  scopeId: Annotation<string | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  /** JSON:API type of the scope root, e.g. "campaigns". Present iff scopeId is. */
  scopeType: Annotation<string | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  /** Neo4j label of the scope root, e.g. "Campaign". Present iff scopeId is. */
  scopeLabel: Annotation<string | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  /**
   * Id of the `Assistant` (thread) node this turn belongs to. Cost attribution
   * falls back to it when the turn has no scope root, so an unscoped turn still
   * bills. Checkpointed, so a resumed run keeps it without being told again.
   */
  assistantId: Annotation<string | undefined>({ reducer: (_, b) => b, default: () => undefined }),
  question: Annotation<string>,
  toolCalls: Annotation<ToolCallRecord[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  references: Annotation<EntityReference[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  citations: Annotation<OperatorCitation[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  iterations: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  tokens: Annotation<{ input: number; output: number }>({
    reducer: (a, b) => ({ input: a.input + b.input, output: a.output + b.output }),
    default: () => ({ input: 0, output: 0 }),
  }),
  finalAnswer: Annotation<OperatorFinalAnswer | null>({ reducer: (_, b) => b, default: () => null }),
});

/**
 * The attribution channels added to the root above, as OPTIONAL properties.
 *
 * LangGraph's `StateType` makes EVERY channel a required property, so adding a
 * channel would add a required key to the PUBLISHED {@link OperatorContextState}
 * (re-exported from `agents/index.ts`) and break any consumer that builds a
 * state literal. Re-declaring them here — the same fix
 * `ContextualiserContextState` and `DriftContextState` use — keeps the state
 * carrying them while existing literals still compile.
 *
 * Only the two channels this branch ADDED are re-declared: `scopeId` /
 * `scopeType` predate it and are left exactly as consumers already see them.
 */
type OperatorAttributionState = Pick<CallerAttributionState, "scopeLabel" | "assistantId">;

/**
 * The un-widened shape LangGraph itself hands to a node callback — every
 * channel required, `StateGraph`'s own view of the state.
 *
 * Nothing in this package consumes it: `OperatorService` builds the graph from
 * `new StateGraph(OperatorContext)` and lets LangGraph infer each node
 * callback's state, so no signature has to name this type. It is exported for
 * the same reason `DriftGraphState` is — a consumer that wants the exact
 * LangGraph view rather than the widened public one — and it is the base
 * {@link OperatorContextState} widens.
 */
export type OperatorGraphState = typeof OperatorContext.State;

export type OperatorContextState = Omit<OperatorGraphState, keyof OperatorAttributionState> & OperatorAttributionState;
