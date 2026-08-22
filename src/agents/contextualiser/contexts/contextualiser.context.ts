import { Annotation } from "@langchain/langgraph";
import { CitationContext } from "../../contextualiser/contexts/citations.context";
import { HistoryContext } from "../../contextualiser/contexts/history.context";
import { NotebookContext } from "../../contextualiser/contexts/notebook.context";
import { PromptContext } from "../../contextualiser/contexts/prompt.context";
import { RequestContext } from "../../contextualiser/contexts/request.context";
import { TokenUsageContext } from "../../../common/contexts/tokenusage.context";
import { DataLimits } from "../../../common/types/data.limits";
import { CallerAttributionState } from "../../common/usage-attribution";

export const ContextualiserContext = Annotation.Root({
  companyId: Annotation<string>({
    default: () => undefined,
    reducer: (current) => current,
  }),
  // ---------------------------------------------------------------------------
  // Cost attribution INHERITED from the calling agent. The contextualiser is a
  // sub-agent: it never bills on its own behalf, so it carries the caller's
  // ledger category and the caller's entity and applies them at every LLM call
  // it makes. All four are absent when a consumer drives the contextualiser
  // directly without attribution — its spend is then simply not recorded.
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
  contentId: Annotation<string>({
    default: () => undefined,
    reducer: (current) => current,
  }),
  contentType: Annotation<string>({
    default: () => undefined,
    reducer: (current) => current,
  }),
  hops: Annotation<number>({
    default: () => undefined,
    reducer: (current, update) => update ?? current ?? 0,
  }),
  /**
   * Provider calls made so far this run. Additive; every node reports the calls
   * it made. Routing reads this, not `hops` — `hops` counts NODES and three of
   * them advance it by two, so it was never a call budget.
   */
  llmCalls: Annotation<number>({
    default: () => 0,
    reducer: (current, update) => (current ?? 0) + (update ?? 0),
  }),
  previousAnalysis: Annotation<string>({
    default: () => undefined,
    reducer: (current) => current,
  }),
  previousAnswer: Annotation<string>({
    default: () => undefined,
    reducer: (current) => current,
  }),
  limits: Annotation<DataLimits>({
    default: () => undefined,
    reducer: (current) => current,
  }),
  prompts: Annotation<typeof PromptContext.State>({
    default: () => undefined,
    reducer: (current) => current,
  }),
  chatHistory: Annotation<(typeof HistoryContext.State)[]>({
    default: () => undefined,
    reducer: (current) => current,
  }),
  question: Annotation<string>({
    default: () => undefined,
    reducer: (current, update) => update ?? current,
  }),
  /**
   * The question's embedding, computed once per turn by the first node that needs
   * it and reused by every later one. Absent until chunk_vector has run.
   */
  questionEmbedding: Annotation<number[] | undefined>({
    default: () => undefined,
    reducer: (current, update) => update ?? current,
  }),
  rationalPlan: Annotation<string>({
    default: () => undefined,
    reducer: (current, update) => update ?? current,
  }),
  annotations: Annotation<string>({
    default: () => undefined,
    reducer: (current, update) => {
      if (!update) return current;
      if (!current) return update;
      if (current.includes(update)) return current;
      return current + "\n" + update;
    },
  }),
  notebook: Annotation<(typeof NotebookContext.State)[]>({
    default: () => undefined,
    reducer: (current, update) => {
      if (!update) return current;
      if (!current) {
        return update;
      }

      const existingIds = new Set(current.map((item) => item.chunkId));
      const newItems = update.filter((item) => !existingIds.has(item.chunkId));

      return [...current, ...newItems];
    },
  }),
  chunkLevel: Annotation<number>({
    default: () => undefined,
    reducer: (current, update) => {
      if (update) return update;
      return current;
    },
  }),
  queuedChunks: Annotation<string[]>({
    default: () => [],
    reducer: (current, update) => {
      if (update === undefined) {
        return current || [];
      }
      // Always replace with the update - this allows clearing processed chunks
      return update;
    },
  }),
  queuedKeyConcepts: Annotation<string[]>({
    default: () => undefined,
    reducer: (current, update) => {
      if (update === undefined) {
        return current;
      }
      if (update.length === 0) {
        return [];
      }
      if (!current) return update;

      const existingIds = new Set(current.map((item) => item));
      const newItems = update.filter((item) => !existingIds.has(item));

      return [...current, ...newItems];
    },
  }),
  processedChunks: Annotation<string[]>({
    default: () => [],
    reducer: (current, update) => {
      if (update === undefined) return current || [];
      if (!current) return update;

      const existingIds = new Set(current);
      const newItems = update.filter((item) => !existingIds.has(item));

      return [...current, ...newItems];
    },
  }),
  processedAtomicFacts: Annotation<string[]>({
    default: () => undefined,
    reducer: (current, update) => {
      if (update === undefined) return current;
      return update;
    },
  }),
  processedKeyConcepts: Annotation<string[]>({
    default: () => undefined,
    reducer: (current, update) => {
      if (update === undefined) return current;
      return update;
    },
  }),
  processedNeighbours: Annotation<string[]>({
    default: () => undefined,
    reducer: (current, update) => {
      if (update === undefined) return current;
      return update;
    },
  }),
  neighbouringAlreadyExplored: Annotation<boolean>({
    default: () => undefined,
    reducer: (current, update) => {
      if (update === undefined) return current;
      return update;
    },
  }),
  sources: Annotation<(typeof CitationContext.State)[]>({
    default: () => undefined,
    reducer: (current, update) => {
      if (update === undefined) return current;
      return [...current, ...update];
    },
  }),
  ontology: Annotation<string[]>({
    default: () => undefined,
    reducer: (current, update) => {
      if (update === undefined) return current;
      return update;
    },
  }),
  requests: Annotation<(typeof RequestContext.State)[]>({
    default: () => undefined,
    reducer: (current, update) => {
      if (update === undefined) return current;
      return update;
    },
  }),
  nextStep: Annotation<string>({
    default: () => undefined,
    reducer: (current, update) => update ?? current,
  }),
  status: Annotation<string[]>({
    default: () => [],
    reducer: (current, update) => {
      if (update === undefined || update.length === 0) return current;
      // Filter out duplicates by combining arrays and using Set
      const combined = [...current, ...update];
      return [...new Set(combined)];
    },
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
});

/**
 * LangGraph's `StateType` makes EVERY channel a required property, so adding a
 * channel to the root above would add a required key to this published type and
 * break any consumer that builds a state literal. The attribution channels are
 * therefore re-declared through {@link CallerAttributionState}, where they are
 * optional — the state still carries them, existing literals still compile.
 *
 * {@link ContextualiserGraphState} is the un-widened shape LangGraph itself
 * hands to a node callback; the graph wiring uses it so the callback signatures
 * still match `StateGraph`'s required-property view.
 */
export type ContextualiserGraphState = typeof ContextualiserContext.State;

export type ContextualiserContextState = Omit<ContextualiserGraphState, keyof CallerAttributionState> &
  CallerAttributionState;
