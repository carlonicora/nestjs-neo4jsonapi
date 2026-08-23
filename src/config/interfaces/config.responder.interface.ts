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
     * When true, a turn that made tool calls but ended with zero successful
     * `traverse` calls gets one structural retry telling the model to walk
     * the graph — or to explicitly stand by a fields-only answer when the
     * question is a pure identity lookup. Off by default: identity lookups
     * legitimately need no traversal, and the retry costs one model round.
     * The instruction is overridable via `prompts.graphNodeDomain.traversalRetry`.
     */
    requireTraversalBeforeAnswer?: boolean;
  };
}
