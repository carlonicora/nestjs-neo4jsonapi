import { ModelWeight } from "../../core/llm/enums/model.weight";
import { ReasoningEffort } from "../../core/llm/enums/reasoning.effort";

/**
 * Responder agent configuration.
 *
 * The responder orchestrates up to three retrieval branches. Each branch can be
 * switched off by the consuming application; when a flag is omitted the branch
 * is enabled.
 */
export interface ConfigResponderInterface {
  /**
   * Per-branch toggles. All default to enabled (`true`) when omitted.
   */
  branches?: {
    /** Graph (tool-driven entity traversal) branch. */
    graph?: boolean;
    /** Contextualiser (GraphRAG multi-hop) branch. */
    contextualiser?: boolean;
    /** DRIFT (community-based) branch. */
    drift?: boolean;
  };
  /**
   * Graph-branch tuning. The graph node's tool loop is the responder's most
   * token-hungry call, and reasoning effort measurably changes whether a model
   * traverses at all — these knobs let an app choose deliberately instead of
   * inheriting the Normal tier's defaults. Omitted = previous behaviour
   * (Normal tier, tier-default effort, no traversal guard).
   */
  graph?: {
    /** Model tier for the graph tool loop and its retries. Default Normal. */
    modelWeight?: ModelWeight;
    /**
     * Reasoning effort for the graph tool loop. Overrides the tier default.
     * Low-effort reasoning models have been observed answering a state
     * question from a record's own stale fields without traversing.
     */
    reasoningEffort?: ReasoningEffort;
    /**
     * When true, the graph output schema gains two required scaffold fields
     * before `answer` — `basisKind` (identity-only | current-state) and
     * `relationshipsWalked` — and a traversal DETECTOR runs: a current-state
     * answer with zero edges walked (successful `traverse`, or `read_entity`
     * whose include returned linked records) is logged and recorded in the
     * trace as `graph.traversalDetector`. It never re-calls the model. Off by
     * default: the schema and behaviour are then unchanged.
     */
    requireTraversalBeforeAnswer?: boolean;
  };
}
