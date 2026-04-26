import { Annotation } from "@langchain/langgraph";
import { ContextualiserContext } from "../../contextualiser/contexts/contextualiser.context";
import { DriftSearchResult } from "../../drift/services/drift.search.service";
import { ResponderAnswerContext } from "./responder.answer.context";
import { TokenUsageContext } from "../../../common/contexts/tokenusage.context";
import { DataLimits } from "../../../common/types/data.limits";
import { MessageInterface } from "../../../common/interfaces/message.interface";
import type { GraphNodeOutput } from "../../graph/interfaces/graph.node.output.interface";
import type { EntityReference } from "../interfaces/entity.reference.interface";
import type { UnifiedTrace } from "../interfaces/unified.trace.interface";

export const ResponderContext = Annotation.Root({
  // existing
  companyId: Annotation<string>,
  contentId: Annotation<string | undefined>,
  contentType: Annotation<string | undefined>,
  dataLimits: Annotation<DataLimits>(),
  context: Annotation<typeof ContextualiserContext.State>({
    default: () => undefined,
    reducer: (current, update) => (current === undefined ? update : current),
  }),
  driftContext: Annotation<DriftSearchResult>({
    default: () => undefined,
    reducer: (current, update) => (current === undefined ? update : current),
  }),
  tokens: Annotation<typeof TokenUsageContext.State>({
    default: () => ({ input: 0, output: 0 }),
    reducer: (current, update) => {
      if (!update) return current;
      return {
        input: (current?.input || 0) + (update?.input || 0),
        output: (current?.output || 0) + (update?.output || 0),
      };
    },
  }),
  finalAnswer: Annotation<typeof ResponderAnswerContext.State>({
    default: () => undefined,
    reducer: (current, update) => (current === undefined ? update : current),
  }),
  sources: Annotation<{ chunkId: string; relevance: number; reason: string }[]>,
  ontologies: Annotation<string[]>,

  // new
  userId: Annotation<string>,
  userModuleIds: Annotation<string[]>,
  rawQuestion: Annotation<string>,
  question: Annotation<string>,
  chatHistory: Annotation<MessageInterface[]>,
  branchPlan: Annotation<{
    runGraph: boolean;
    runContextualiser: boolean;
    runDrift: boolean;
    reasoning: string;
  }>,
  graphContext: Annotation<GraphNodeOutput>({
    default: () => undefined,
    reducer: (current, update) => (current === undefined ? update : current),
  }),
  references: Annotation<EntityReference[]>,
  plannerError: Annotation<string | null>({ default: () => null, reducer: (_c, u) => u ?? _c }),
  graphError: Annotation<string | null>({ default: () => null, reducer: (_c, u) => u ?? _c }),
  contextualiserError: Annotation<string | null>({ default: () => null, reducer: (_c, u) => u ?? _c }),
  driftError: Annotation<string | null>({ default: () => null, reducer: (_c, u) => u ?? _c }),
  trace: Annotation<UnifiedTrace>({
    default: () =>
      ({
        planner: {
          reasoning: "",
          branchPlan: { runGraph: false, runContextualiser: false, runDrift: false },
          tokens: { input: 0, output: 0 },
        },
        answer: { branchesUsed: [], tokens: { input: 0, output: 0 } },
        totalTokens: { input: 0, output: 0 },
      }) as UnifiedTrace,
    reducer: (current, update) => ({ ...current, ...update }),
  }),
});

export type ResponderContextState = typeof ResponderContext.State;
