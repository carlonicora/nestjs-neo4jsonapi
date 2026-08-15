/**
 * The Neo4j labels a consuming application allows the token-usage breakdown to
 * group by through the polymorphic USED_FOR edge.
 *
 * The label SELECTS A CYPHER CLAUSE — it is not a bound value — so it can never
 * be taken from the request unchecked. The repository matches the requested
 * label against this allowlist and throws BadRequestException on a miss; nothing
 * that did not come from here ever reaches the query text.
 *
 * Supplied by the app from a @Global() module, mirroring
 * ASSISTANT_SEED_CONTEXT_PROVIDERS: the library's TokenUsageModule cannot import
 * an application feature module, and consumes this with
 * @Optional() @Inject(TOKEN_USAGE_TARGET_LABELS). Absent → [] → dimension=target
 * is rejected, which is the correct default for an app that has not opted in.
 */
export const TOKEN_USAGE_TARGET_LABELS = Symbol("TOKEN_USAGE_TARGET_LABELS");

/** Dimensions the administrative (cross-tenant) breakdown can group by. */
export type TokenUsageDimension = "company" | "user" | "operation" | "target";

/**
 * Dimensions the self-service breakdown can group by. Company and user are
 * absent by design: inside a single tenant the company dimension is one row and
 * the user dimension exposes colleagues' individual spend.
 */
export type TokenUsageReportDimension = "operation" | "target";

/** Metrics the self-service surface may request. `cost` is deliberately absent. */
export type TokenUsageReportMetric = "credits" | "tokens";

/**
 * One attributable target an app opts into.
 *
 * A bare string keeps the original meaning: match only what USED_FOR points at
 * directly. The object form adds a ROLLUP — usage recorded against a subordinate
 * entity is credited to the owner it belongs to.
 *
 * That rollup is not a nicety. narr8 attributes a session recap to the Session,
 * an assistant reply to the Assistant and a graph completion to the Npc, while
 * only some operations name the Campaign directly. Grouping on direct edges
 * alone silently drops every one of those rows — the panel then shows a total
 * far below the same window's by-operation total, and a campaign whose whole
 * spend arrived through sessions does not appear at all.
 *
 * `via` names the relationship types the traversal may follow, and like `label`
 * it SELECTS CYPHER TEXT rather than binding a value. Both come from this
 * app-supplied allowlist and are re-validated against `SAFE_IDENTIFIER` before
 * they reach a query.
 */
export type TokenUsageTargetLabel =
  | string
  | {
      /** The Neo4j label rows are grouped by, e.g. "Campaign". */
      label: string;
      /** Relationship types the rollup may traverse, e.g. ["PART_OF", "BOUND_TO"]. */
      via?: string[];
      /** Hops allowed. Defaults to 1; 0 disables the rollup. */
      maxDepth?: number;
    };

/** A target label after defaulting, ready to build Cypher from. */
export type ResolvedTokenUsageTarget = {
  label: string;
  via: string[];
  maxDepth: number;
};

/**
 * Neo4j labels and relationship types are identifiers, not values, so they
 * cannot be parameterised. Everything interpolated into a query is checked
 * against this first — a second lock behind the allowlist, so a typo or a
 * careless app config fails loudly instead of producing arbitrary Cypher.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Applies the defaults and rejects anything that is not a plain identifier. */
export function normaliseTargetLabel(entry: TokenUsageTargetLabel): ResolvedTokenUsageTarget {
  const resolved: ResolvedTokenUsageTarget =
    typeof entry === "string"
      ? { label: entry, via: [], maxDepth: 0 }
      : { label: entry.label, via: entry.via ?? [], maxDepth: entry.maxDepth ?? 1 };

  if (!SAFE_IDENTIFIER.test(resolved.label))
    throw new Error(`TOKEN_USAGE_TARGET_LABELS: "${resolved.label}" is not a valid Neo4j label`);

  for (const relationship of resolved.via)
    if (!SAFE_IDENTIFIER.test(relationship))
      throw new Error(`TOKEN_USAGE_TARGET_LABELS: "${relationship}" is not a valid relationship type`);

  return resolved;
}

/**
 * The Cypher that binds `grp` to the entity a usage row is attributed to.
 *
 * Lives here rather than in either repository because the administrative and
 * the self-service breakdowns must group identically — two copies of this
 * traversal would drift, and the two surfaces would then report different
 * totals for the same window.
 *
 * With no rollup it is the original direct match. With one, the traversal is
 * `*0..maxDepth`: depth zero keeps rows that already point at the target label,
 * so a campaign named directly and a campaign reached through its session land
 * in the same bucket.
 *
 * `head(collect(...))` is deliberate. An entity reachable from two targets would
 * otherwise multiply its row and be counted once per path, inflating the totals;
 * collapsing to one target per usage record keeps the column summing to the same
 * figure the by-operation panel reports. Ordering by id makes the pick stable
 * across requests rather than dependent on traversal order.
 *
 * @param carried the variables that must survive into the grouping, in order —
 *   the admin query carries its company node, the report query does not.
 */
export function buildTargetGrouping(params: {
  target: ResolvedTokenUsageTarget;
  nodeName: string;
  carried: string[];
}): string {
  const { target, nodeName, carried } = params;
  const carry = [nodeName, ...carried].join(", ");

  if (target.via.length === 0 || target.maxDepth === 0)
    return `MATCH (${nodeName})-[:USED_FOR]->(grp:${target.label})\n      WITH ${carry}, grp`;

  // One leading colon, then bare types: `:A|B`. Neo4j rejects the repeated-colon
  // form `:A|:B` whenever a variable length is attached, which this always has.
  const relationships = `:${target.via.join("|")}`;

  return [
    `MATCH (${nodeName})-[:USED_FOR]->(usageTarget)`,
    `      OPTIONAL MATCH (usageTarget)-[${relationships}*0..${target.maxDepth}]->(rollup:${target.label})`,
    `      WITH ${carry}, usageTarget, rollup ORDER BY rollup.id`,
    `      WITH ${carry}, head(collect(rollup)) AS grp`,
    `      WHERE grp IS NOT NULL`,
  ].join("\n");
}
