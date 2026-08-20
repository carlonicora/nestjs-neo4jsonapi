/**
 * The scope ROOT one agent run is confined to.
 *
 * A scope root is a catalogued entity whose compiled scope chain is empty —
 * every other entity reaches it through a chain of relationship hops. A run
 * bound to one may read only content that reaches that root.
 *
 * WHY THIS IS AMBIENT (CLS) RATHER THAN A PARAMETER
 * -------------------------------------------------
 * Retrieval reads the run's scope from CLS for the same reason it reads
 * `companyId` from CLS: a security boundary that every call site must REMEMBER
 * to pass is a boundary that eventually is not passed. Publishing it once per
 * turn, next to `companyId`, means a new retrieval path is confined by
 * construction rather than by review.
 */
export interface AgentScope {
  /** Id of the scope-root node. */
  id: string;
  /** JSON:API type of the scope root, e.g. "campaigns". */
  type: string;
  /** Neo4j label of the scope root, e.g. "Campaign". */
  label: string;
}

/**
 * CLS key under which a turn publishes its `AgentScope`.
 *
 * Absent = the run is deliberately unscoped (company-wide MCP tools, a worker
 * job, an app with no scope roots at all) and retrieval behaves as it always
 * has. Present = every retrieval in the turn is confined to that root.
 */
export const AGENT_SCOPE_CLS_KEY = "agentScope";
