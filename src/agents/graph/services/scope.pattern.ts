import { CatalogScope } from "../interfaces/graph.catalog.interface";

/**
 * `(alias)-[:REL]->(:Label)…-[:REL]->(:Root { id: $<paramName> })`
 *
 * The single place a scope chain becomes Cypher. Both consumers — `ScopeGuard`
 * (post-filtering records an agent already read) and `ScopePredicateService`
 * (pre-filtering retrieval before it reads anything) — build their patterns
 * here, so "is this node inside the run's scope root" cannot drift between
 * the two.
 */
export const buildScopePattern = (params: {
  scope: CatalogScope;
  alias: string;
  /** Pins the root to a known id: `(:Root { id: $<paramName> })`. */
  paramName?: string;
  /**
   * Binds the root to a variable instead of pinning it: `(<rootAlias>:Root)`.
   * For the inverse question — "which root is this node under?" — where the id
   * is the answer rather than the input. Ignored when `paramName` is given.
   */
  rootAlias?: string;
}): string => {
  let pattern = `(${params.alias})`;
  params.scope.path.forEach((hop, index) => {
    const isLast = index === params.scope.path.length - 1;
    const root = params.paramName
      ? `(:${hop.targetLabel} { id: $${params.paramName} })`
      : `(${params.rootAlias ?? "scopeRoot"}:${hop.targetLabel})`;
    const node = isLast ? root : `(:${hop.targetLabel})`;
    pattern += hop.cypherDirection === "out" ? `-[:${hop.cypherLabel}]->${node}` : `<-[:${hop.cypherLabel}]-${node}`;
  });
  return pattern;
};
