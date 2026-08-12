// nja-lint-ignore-file: cross-tenant administrative read repository.
//
// Every query here deliberately omits buildDefaultMatch(): that helper scopes to
// the CALLER's company via CLS, which is exactly wrong for a platform-wide admin
// dashboard. Access is gated instead by the controller's JwtAuthGuard +
// @Roles(Administrator) (see tokenusage.admin.controller.ts). Rollup RETURNs are
// scalar columns, not graph nodes, so readOne()/readMany() cannot map them —
// entityFactory.createGraphList expects nodes. Same shape and same rationale as
// apps/api/src/features/administration/platform-kpi/repositories/platform-kpi.read.repository.ts.
//
// The architecture gate raises a FILE-LEVEL manual-query-no-company-scope finding
// on this shape; per-line ignores do not clear it, so this header note is the
// documented resolution.
import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { convertFieldValue } from "../../../common/helpers/define-entity";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { TokenUsageAdminBreakdownEntity } from "../entities/tokenusage-admin-breakdown";
import { TokenUsageAdminSummaryEntity } from "../entities/tokenusage-admin-summary";
import {
  TokenUsageAdminTimelineDescriptor,
  TokenUsageAdminTimelineEntity,
} from "../entities/tokenusage-admin-timeline";
import { TokenUsage, TokenUsageDescriptor } from "../entities/tokenusage";
import { tokenUsageMeta } from "../entities/tokenusage.meta";

const NODE = tokenUsageMeta.nodeName; // "tokenusage"

/**
 * The `date.truncate` units this repository is allowed to emit, keyed by the
 * granularity it accepts. A lookup rather than a raw interpolation of the
 * caller's string: nothing that did not come from this table can ever reach the
 * query text.
 */
const TRUNCATION_UNITS: Record<"week" | "month", string> = {
  week: "week",
  month: "month",
};

/** The shared metric field set every admin resource exposes. */
type UsageMetrics = {
  cost: number;
  credits: number;
  tokensIn: number;
  tokensOut: number;
  cached: number;
  calls: number;
};

const toNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof (v as { toNumber?: () => number }).toNumber === "function")
    return (v as { toNumber: () => number }).toNumber();
  return Number(v) || 0;
};

const round = (v: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/**
 * Cross-tenant reporting queries behind /tokenusages/administration/*.
 *
 * Extends AbstractRepository for the shared Neo4j/security/CLS plumbing and the
 * descriptor typing; none of the inherited finders are used, for the reasons in
 * the file header, and it deliberately does NOT override onModuleInit — the
 * :TokenUsage indexes belong to TokenUsageRepository.
 *
 * EVERY traversal constrains its target label — `->(:Company)`, `->(:User)`.
 * The write bug fixed in tokenusage.repository.ts left 12,237 label-less nodes
 * on exactly these two relationships; an unconstrained match returns them.
 */
@Injectable()
export class TokenUsageAdminRepository extends AbstractRepository<
  TokenUsage,
  typeof TokenUsageDescriptor.relationships
> {
  protected readonly descriptor = TokenUsageDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Six rows: {customer, platform, total} × {current, previous}. The previous
   * window is the equal-length span immediately preceding `from`, which is what
   * the KPI tiles' deltas are computed against.
   */
  async findSummary(params: { from: string; to: string; companyId?: string }): Promise<TokenUsageAdminSummaryEntity[]> {
    const previous = this._previousWindow(params.from, params.to);

    const [current, prior] = await Promise.all([
      this._scopeTotals({ from: params.from, to: params.to, companyId: params.companyId }),
      this._scopeTotals({ from: previous.from, to: previous.to, companyId: params.companyId }),
    ]);

    return [...this._withTotal(current, "current"), ...this._withTotal(prior, "previous")];
  }

  async findTimeline(params: {
    from: string;
    to: string;
    granularity: "day" | "week" | "month";
    stackBy: "scope" | "type" | "company";
    companyId?: string;
  }): Promise<TokenUsageAdminTimelineEntity[]> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      from: params.from,
      to: params.to,
      companyId: params.companyId ?? null,
      // Cypher accepts a parameter for date.truncate's unit (verified against
      // DozerDB 5.26), so the granularity is bound rather than interpolated —
      // the "always parameterised, never interpolated" guardrail applies here
      // even though _truncationUnit() already whitelists the value.
      granularity: params.granularity === "day" ? null : this._truncationUnit(params.granularity),
    };

    const bucket =
      params.granularity === "day" ? `date(${NODE}.createdAt)` : `date.truncate($granularity, ${NODE}.createdAt)`;

    const series =
      params.stackBy === "type"
        ? `${NODE}.tokenUsageType`
        : params.stackBy === "company"
          ? `coalesce(c.name, 'platform')`
          : `CASE WHEN c IS NULL THEN 'platform' ELSE 'customer' END`;

    query.query += `
      MATCH (${NODE}:${tokenUsageMeta.labelName})
      WHERE ${NODE}.createdAt >= datetime($from) AND ${NODE}.createdAt <= datetime($to)
      OPTIONAL MATCH (${NODE})-[:BELONGS_TO]->(c:Company)
      WITH ${NODE}, c
      WHERE $companyId IS NULL OR c.id = $companyId
      WITH ${bucket} AS bucket, ${series} AS series, ${NODE}
      RETURN bucket                                  AS bucket,
             series                                  AS series,
             sum(toFloat(${NODE}.cost))              AS cost,
             sum(toFloat(${NODE}.credits))           AS credits,
             sum(toInteger(${NODE}.inputTokens))     AS tokensIn,
             sum(toInteger(${NODE}.outputTokens))    AS tokensOut,
             sum(toInteger(${NODE}.cachedInputTokens)) AS cached,
             count(${NODE})                          AS calls
      ORDER BY bucket ASC, series ASC
    `;

    const result = await this.neo4j.read(query.query, query.queryParams);

    // The driver hands back a native Neo4j Date. convertFieldValue is the
    // framework's single implementation of the descriptor-typed read-path
    // conversion — the same one the auto-generated mapper() uses. Never
    // toString() it in Cypher, never re-format it here. The field type is read
    // off the descriptor so the two can never drift.
    const bucketType = TokenUsageAdminTimelineDescriptor.fields.bucket?.type ?? "date";

    return result.records.map((r: any) => {
      const bucketValue = convertFieldValue(r.get("bucket"), bucketType) as string;
      const seriesValue = r.get("series") as string;
      return {
        id: `${bucketValue}|${seriesValue}`,
        bucket: bucketValue,
        series: seriesValue,
        ...this._metrics(r),
      } as TokenUsageAdminTimelineEntity;
    });
  }

  /**
   * Ranked rows, descending by cost, truncated to `limit` with the exact
   * remainder folded into a single "other" row. The full ordered set is fetched
   * and sliced in JS so the remainder is exact rather than a second query's
   * approximation. Above ~1000 companies, move the LIMIT into Cypher and take
   * the remainder from findSummary() instead.
   */
  async findBreakdown(params: {
    from: string;
    to: string;
    dimension: "company" | "user" | "operation";
    scope: "customer" | "platform";
    companyId?: string;
    limit: number;
  }): Promise<TokenUsageAdminBreakdownEntity[]> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      from: params.from,
      to: params.to,
      companyId: params.companyId ?? null,
    };

    const companyMatch =
      params.scope === "customer"
        ? `MATCH (${NODE})-[:BELONGS_TO]->(c:Company)`
        : `OPTIONAL MATCH (${NODE})-[:BELONGS_TO]->(c:Company)\n      WITH ${NODE}, c\n      WHERE c IS NULL`;

    // activeUsers is only meaningful for the company dimension; the optional
    // match is emitted only there so the other dimensions do not pay for it.
    const activeUserMatch = params.dimension === "company" ? `OPTIONAL MATCH (${NODE})-[:TRIGGERED_BY]->(u:User)` : "";

    let grouping: string;
    let projection: string;

    if (params.dimension === "company") {
      // `u` is carried through the WITH: dropping it here would leave
      // count(DISTINCT u) referencing an out-of-scope variable.
      grouping = `WITH ${NODE}, c AS grp, u`;
      projection = `
             grp.id                          AS id,
             grp.name                        AS label,
             null                            AS sublabel,
             count(DISTINCT u)               AS activeUsers,
             head(collect(grp.monthlyCredits))          AS monthlyCredits,
             head(collect(grp.availableMonthlyCredits)) AS availableMonthlyCredits,`;
    } else if (params.dimension === "user") {
      grouping = `MATCH (${NODE})-[:TRIGGERED_BY]->(u:User)\n      WITH ${NODE}, c, u AS grp`;
      projection = `
             grp.id                          AS id,
             coalesce(grp.name, grp.email)   AS label,
             head(collect(c.name))           AS sublabel,
             null                            AS activeUsers,
             null                            AS monthlyCredits,
             null                            AS availableMonthlyCredits,`;
    } else {
      grouping = `WITH ${NODE}, c, ${NODE}.tokenUsageType AS grp`;
      projection = `
             grp                             AS id,
             grp                             AS label,
             null                            AS sublabel,
             null                            AS activeUsers,
             null                            AS monthlyCredits,
             null                            AS availableMonthlyCredits,`;
    }

    query.query += `
      MATCH (${NODE}:${tokenUsageMeta.labelName})
      WHERE ${NODE}.createdAt >= datetime($from) AND ${NODE}.createdAt <= datetime($to)
      ${companyMatch}
      WITH ${NODE}, c
      WHERE $companyId IS NULL OR c.id = $companyId
      ${activeUserMatch}
      ${grouping}
      RETURN ${projection}
             sum(toFloat(${NODE}.cost))              AS cost,
             sum(toFloat(${NODE}.credits))           AS credits,
             sum(toInteger(${NODE}.inputTokens))     AS tokensIn,
             sum(toInteger(${NODE}.outputTokens))    AS tokensOut,
             sum(toInteger(${NODE}.cachedInputTokens)) AS cached,
             count(${NODE})                          AS calls
      ORDER BY cost DESC
    `;

    const result = await this.neo4j.read(query.query, query.queryParams);

    const all: TokenUsageAdminBreakdownEntity[] = result.records.map((r: any) => {
      const sublabel = r.get("sublabel");
      const activeUsers = r.get("activeUsers");
      const monthlyCredits = r.get("monthlyCredits");
      const availableMonthlyCredits = r.get("availableMonthlyCredits");
      return {
        id: r.get("id") as string,
        label: (r.get("label") as string) ?? (r.get("id") as string),
        ...(sublabel ? { sublabel: sublabel as string } : {}),
        ...(activeUsers === null || activeUsers === undefined ? {} : { activeUsers: toNumber(activeUsers) }),
        ...(monthlyCredits === null || monthlyCredits === undefined
          ? {}
          : { monthlyCredits: toNumber(monthlyCredits) }),
        ...(availableMonthlyCredits === null || availableMonthlyCredits === undefined
          ? {}
          : { availableMonthlyCredits: toNumber(availableMonthlyCredits) }),
        ...this._metrics(r),
      } as TokenUsageAdminBreakdownEntity;
    });

    if (all.length <= params.limit) return all;

    const top = all.slice(0, params.limit);
    const tail = all.slice(params.limit);

    const other: TokenUsageAdminBreakdownEntity = {
      id: "other",
      label: "other",
      cost: round(
        tail.reduce((s, r) => s + r.cost, 0),
        4,
      ),
      credits: round(
        tail.reduce((s, r) => s + r.credits, 0),
        4,
      ),
      tokensIn: tail.reduce((s, r) => s + r.tokensIn, 0),
      tokensOut: tail.reduce((s, r) => s + r.tokensOut, 0),
      cached: tail.reduce((s, r) => s + r.cached, 0),
      calls: tail.reduce((s, r) => s + r.calls, 0),
    } as TokenUsageAdminBreakdownEntity;

    return [...top, other];
  }

  /** Scalar rollup split by cost centre for one window. */
  private async _scopeTotals(params: {
    from: string;
    to: string;
    companyId?: string;
  }): Promise<Array<{ scope: string } & UsageMetrics>> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      from: params.from,
      to: params.to,
      companyId: params.companyId ?? null,
    };

    query.query += `
      MATCH (${NODE}:${tokenUsageMeta.labelName})
      WHERE ${NODE}.createdAt >= datetime($from) AND ${NODE}.createdAt <= datetime($to)
      OPTIONAL MATCH (${NODE})-[:BELONGS_TO]->(c:Company)
      WITH ${NODE}, c
      WHERE $companyId IS NULL OR c.id = $companyId
      WITH CASE WHEN c IS NULL THEN 'platform' ELSE 'customer' END AS scope, ${NODE}
      RETURN scope                                   AS scope,
             sum(toFloat(${NODE}.cost))              AS cost,
             sum(toFloat(${NODE}.credits))           AS credits,
             sum(toInteger(${NODE}.inputTokens))     AS tokensIn,
             sum(toInteger(${NODE}.outputTokens))    AS tokensOut,
             sum(toInteger(${NODE}.cachedInputTokens)) AS cached,
             count(${NODE})                          AS calls
    `;

    const result = await this.neo4j.read(query.query, query.queryParams);

    return result.records.map((r: any) => ({ scope: r.get("scope") as string, ...this._metrics(r) }));
  }

  /**
   * Guarantees both cost centres are present (zero-filled when a window has no
   * rows) and appends their sum as the "total" scope, so the tiles never have to
   * branch on a missing row.
   */
  private _withTotal(rows: Array<{ scope: string } & UsageMetrics>, window: string): TokenUsageAdminSummaryEntity[] {
    const zero: UsageMetrics = { cost: 0, credits: 0, tokensIn: 0, tokensOut: 0, cached: 0, calls: 0 };
    const find = (scope: string) => rows.find((r) => r.scope === scope) ?? { scope, ...zero };

    const customer = find("customer");
    const platform = find("platform");

    const total = {
      scope: "total",
      cost: round(customer.cost + platform.cost, 4),
      credits: round(customer.credits + platform.credits, 4),
      tokensIn: customer.tokensIn + platform.tokensIn,
      tokensOut: customer.tokensOut + platform.tokensOut,
      cached: customer.cached + platform.cached,
      calls: customer.calls + platform.calls,
    };

    return [customer, platform, total].map((r) => ({
      id: `${r.scope}|${window}`,
      scope: r.scope,
      window,
      cost: r.cost,
      credits: r.credits,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      cached: r.cached,
      calls: r.calls,
    })) as TokenUsageAdminSummaryEntity[];
  }

  /** The equal-length span immediately preceding `from`. */
  private _previousWindow(from: string, to: string): { from: string; to: string } {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const span = Math.max(0, toMs - fromMs);
    return { from: new Date(fromMs - span).toISOString(), to: new Date(fromMs).toISOString() };
  }

  /**
   * Resolves a granularity to the `date.truncate` unit it may emit. Throws
   * rather than interpolating anything the table does not know about.
   */
  private _truncationUnit(granularity: "week" | "month"): string {
    const unit = TRUNCATION_UNITS[granularity];
    if (!unit) throw new Error(`Unsupported timeline granularity: ${granularity}`);
    return unit;
  }

  private _metrics(record: any): UsageMetrics {
    return {
      cost: round(toNumber(record.get("cost")), 4),
      credits: round(toNumber(record.get("credits")), 4),
      tokensIn: toNumber(record.get("tokensIn")),
      tokensOut: toNumber(record.get("tokensOut")),
      cached: toNumber(record.get("cached")),
      calls: toNumber(record.get("calls")),
    };
  }
}
