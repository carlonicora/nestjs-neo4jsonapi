import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { SCOPE_PREDICATE_SOURCE, ScopePredicateSource } from "./scope-predicate.source";
import { AGENT_SCOPE_CLS_KEY, AgentScope } from "../types/agent.scope";
import { DataLimits } from "../types/data.limits";

/** A Cypher fragment to place immediately after the source query's `WITH <alias>`. */
export interface AgentScopeFilter {
  /** `WHERE …`, or `""` when the run is deliberately unscoped. */
  cypher: string;
  params: Record<string, unknown>;
  /** True when a scope was in force and the fragment narrows retrieval. */
  applied: boolean;
}

const UNSCOPED: AgentScopeFilter = { cypher: "", params: {}, applied: false };

/**
 * The retrieval-side half of scope enforcement.
 *
 * WHY THIS IS NOT INSIDE `AiSourceQueryProvider`: that provider is an app
 * override point (`CoreModule.forRoot({ aiSourceQuery })`). Putting the scope
 * predicate inside the DEFAULT implementation would mean any app that
 * customised its source query silently opted out of scope enforcement — a
 * fail-OPEN seam guarding a security boundary. Applying the filter at the call
 * sites, on top of whatever the provider returned, makes the guard impossible
 * for an override to drop.
 */
@Injectable()
export class AgentScopeFilterService {
  private readonly logger = new Logger(AgentScopeFilterService.name);

  constructor(
    private readonly cls: ClsService,
    @Optional() @Inject(SCOPE_PREDICATE_SOURCE) private readonly predicates?: ScopePredicateSource,
  ) {}

  /** The scope published for this turn, if any. */
  current(): AgentScope | undefined {
    const scope = this.cls.has(AGENT_SCOPE_CLS_KEY)
      ? (this.cls.get(AGENT_SCOPE_CLS_KEY) as AgentScope | undefined)
      : undefined;
    return scope?.id && scope?.type ? scope : undefined;
  }

  /**
   * Builds the `WHERE` that confines `alias` to the run's scope root.
   *
   * Three outcomes, all deliberate:
   *  - no scope in CLS, or a HowTo run → `""`. HowTo content is global and has
   *    no scope root; help mode is scope-independent by design.
   *  - scope + a predicate → `WHERE (…)`, retrieval narrowed to that root.
   *  - scope + NO predicate (no `SCOPE_PREDICATE_SOURCE` registered, or no
   *    entity can reach the root) → `WHERE false`. FAIL CLOSED: a run that
   *    declares a scope it cannot enforce retrieves nothing. Returning `""`
   *    here would silently restore company-wide retrieval — a cross-scope leak,
   *    which is the whole failure this guard exists to prevent.
   */
  build(params: { alias: string; dataLimits?: DataLimits }): AgentScopeFilter {
    const predicate = this.predicate(params);
    if (!predicate) return UNSCOPED;
    return { cypher: `WHERE ${predicate.cypher}`, params: predicate.params, applied: true };
  }

  /**
   * The bare boolean expression, for callers that must embed it somewhere a
   * standalone `WHERE` cannot go — inside an `EXISTS { … }`, or ANDed onto a
   * clause that already has a `WHERE`.
   *
   * `null` means the run is unscoped and nothing should be filtered. It never
   * means "could not work it out": that case returns the constant `false`.
   */
  predicate(params: {
    alias: string;
    dataLimits?: DataLimits;
  }): { cypher: string; params: Record<string, unknown> } | null {
    if (params.dataLimits?.howToMode || params.dataLimits?.limitToHowToId) return null;

    const scope = this.current();
    if (!scope) return null;

    const predicate = this.predicates?.build({ alias: params.alias, scope });
    if (!predicate) {
      this.logger.error(
        `predicate: run is scoped to ${scope.type}:${scope.id} but no scope predicate could be compiled ` +
          `(${this.predicates ? "no entity reaches that root" : "no SCOPE_PREDICATE_SOURCE registered"}) — ` +
          `failing closed, this retrieval returns nothing.`,
      );
      return { cypher: "false", params: {} };
    }

    return predicate;
  }
}
