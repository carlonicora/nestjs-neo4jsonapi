import { AgentScope } from "../types/agent.scope";

export interface ScopePredicateResult {
  /**
   * A Cypher BOOLEAN EXPRESSION over `alias` — no `WHERE`, no `AND` prefix, so
   * the caller decides how to join it. References `$agentScopeId` only.
   */
  cypher: string;
  /** Parameters the expression references — bound, never interpolated. */
  params: Record<string, unknown>;
}

/**
 * Compiles "is this node inside the run's scope root?" into Cypher.
 *
 * The knowledge needed to answer that — every entity type's hop chain to the
 * scope root — lives in the graph catalog, which sits ABOVE the core layer
 * where retrieval repositories live. This token is the seam between the two:
 * the graph layer registers an implementation, and core-layer retrieval asks
 * for a predicate without depending on the catalog.
 *
 * FAIL-CLOSED CONTRACT: an implementation returns `null` only when it can
 * prove nothing is in scope. A caller holding a scope that gets `null` MUST
 * retrieve nothing — never fall back to unfiltered retrieval, which is the
 * cross-scope leak this seam exists to prevent.
 */
export interface ScopePredicateSource {
  build(params: { alias: string; scope: AgentScope }): ScopePredicateResult | null;
}

export const SCOPE_PREDICATE_SOURCE = Symbol("SCOPE_PREDICATE_SOURCE");
