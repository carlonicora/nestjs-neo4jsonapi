import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
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
export type OperatorContextState = typeof OperatorContext.State;
