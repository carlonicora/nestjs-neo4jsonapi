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
}
