import { Annotation } from "@langchain/langgraph";
import { TokenUsageContext } from "../../../common/contexts/tokenusage.context";
import { Community } from "../../../foundations/community/entities/community.entity";
import { CallerAttributionState } from "../../common/usage-attribution";

export interface FollowUpAnswer {
  question: string;
  answer: string;
  depth: number;
  additionalQuestions: string[];
  shouldContinue: boolean;
}

export const DriftContext = Annotation.Root({
  // Input
  question: Annotation<string>,
  topK: Annotation<number>({
    default: () => 5,
    reducer: (current, update) => update ?? current,
  }),
  maxDepth: Annotation<number>({
    default: () => 2,
    reducer: (current, update) => update ?? current,
  }),

  // ---------------------------------------------------------------------------
  // Cost attribution INHERITED from the calling agent. DRIFT is a sub-agent: it
  // never bills on its own behalf, so it carries the caller's ledger category
  // and the caller's entity and applies them at every LLM and embedding call it
  // makes. All absent when a consumer drives DRIFT directly without
  // attribution — its spend is then simply not recorded.
  // ---------------------------------------------------------------------------
  /** Ledger category of the CALLING agent, e.g. `TokenUsageType.Responder`. */
  tokenUsageType: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (current, update) => update ?? current,
  }),
  /** Id of the caller's scope-root node. Absent = the caller ran unscoped. */
  scopeId: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (current, update) => update ?? current,
  }),
  /** JSON:API type of the caller's scope root, e.g. "campaigns". */
  scopeType: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (current, update) => update ?? current,
  }),
  /** Neo4j label of the caller's scope root, e.g. "Campaign". */
  scopeLabel: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (current, update) => update ?? current,
  }),
  /** Id of the caller's `Assistant` (thread) node — the unscoped fallback. */
  assistantId: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (current, update) => update ?? current,
  }),

  // Workflow control
  nextStep: Annotation<string>({
    default: () => "hyde",
    reducer: (current, update) => update || current,
  }),
  hops: Annotation<number>({
    default: () => 0,
    reducer: (current, update) => (current ?? 0) + (update ?? 0),
  }),

  // HyDE phase
  hypotheticalAnswer: Annotation<string>({
    default: () => "",
    reducer: (current, update) => update || current,
  }),
  hydeEmbedding: Annotation<number[]>({
    default: () => [],
    reducer: (current, update) => (update && update.length > 0 ? update : current),
  }),

  // Community search phase
  matchedCommunities: Annotation<Community[]>({
    default: () => [],
    reducer: (current, update) => (update && update.length > 0 ? update : current),
  }),
  communitySummaries: Annotation<string>({
    default: () => "",
    reducer: (current, update) => update || current,
  }),

  // Primer answer phase
  initialAnswer: Annotation<string>({
    default: () => "",
    reducer: (current, update) => update || current,
  }),
  followUpQuestions: Annotation<string[]>({
    default: () => [],
    reducer: (current, update) => (update && update.length > 0 ? update : current),
  }),
  confidence: Annotation<number>({
    default: () => 0,
    reducer: (current, update) => update ?? current,
  }),

  // Follow-up phase
  currentFollowUpIndex: Annotation<number>({
    default: () => 0,
    reducer: (current, update) => update ?? current,
  }),
  currentDepth: Annotation<number>({
    default: () => 0,
    reducer: (current, update) => update ?? current,
  }),
  followUpAnswers: Annotation<FollowUpAnswer[]>({
    default: () => [],
    reducer: (current, update) => [...(current ?? []), ...(update ?? [])],
  }),
  priorContext: Annotation<string>({
    default: () => "",
    reducer: (current, update) => update || current,
  }),

  // Synthesis phase
  finalAnswer: Annotation<string>({
    default: () => "",
    reducer: (current, update) => update || current,
  }),

  // Token tracking
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
});

/**
 * LangGraph's `StateType` makes EVERY channel a required property, so adding a
 * channel to the root above would add a required key to this PUBLISHED type
 * (`DriftContextState` is exported from `agents/index.ts`) and break any
 * consumer that builds a state literal. The attribution channels are therefore
 * re-declared through {@link CallerAttributionState}, where they are optional —
 * the state still carries them, existing literals still compile.
 *
 * {@link DriftGraphState} is the un-widened shape LangGraph itself hands to a
 * node callback; the graph wiring uses it so the callback signatures still
 * match `StateGraph`'s required-property view.
 */
export type DriftGraphState = typeof DriftContext.State;

export type DriftContextState = Omit<DriftGraphState, keyof CallerAttributionState> & CallerAttributionState;
