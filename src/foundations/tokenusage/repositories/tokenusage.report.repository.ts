import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import {
  buildTargetGrouping,
  normaliseTargetLabel,
  ResolvedTokenUsageTarget,
  TOKEN_USAGE_TARGET_LABELS,
  TokenUsageReportDimension,
  TokenUsageReportMetric,
  TokenUsageTargetLabel,
} from "../common/tokenusage.target-labels";
import { TokenUsage, TokenUsageDescriptor } from "../entities/tokenusage";
import { tokenUsageMeta } from "../entities/tokenusage.meta";
import { TokenUsageReportBreakdownEntity } from "../entities/tokenusage-report-breakdown";
import { TokenUsageReportSummaryEntity } from "../entities/tokenusage-report-summary";
import { TokenUsageReportTimelineEntity } from "../entities/tokenusage-report-timeline";

const NODE = tokenUsageMeta.nodeName; // "tokenusage"

/**
 * The date.truncate units this repository may emit, keyed by granularity. A
 * lookup rather than an interpolation of the caller's string: nothing that did
 * not come from this table can ever reach the query text.
 */
const TRUNCATION_UNITS: Record<"week" | "month", string> = {
  week: "week",
  month: "month",
};

/** The metric column each breakdown orders by. Same closed-lookup rule. */
const ORDER_COLUMNS: Record<TokenUsageReportMetric, string> = {
  credits: "credits",
  tokens: "tokens",
};

/**
 * Self-service token-usage reporting: the caller's OWN company, nothing else.
 *
 * This is the deliberate mirror image of TokenUsageAdminRepository. That class
 * carries a file-level lint-ignore and omits buildDefaultMatch() because a
 * platform-wide dashboard must not be scoped to the caller. THIS class must be
 * scoped, so every query below goes through buildDefaultMatch(), which injects
 * the CLS company filter. There is deliberately no file-level ignore header
 * here, and no companyId parameter anywhere in this file: a self-service caller
 * cannot name a company, so there is nothing to spoof.
 *
 * Rollup RETURNs are scalar columns, not graph nodes, so readOne()/readMany()
 * cannot map them - entityFactory.createGraphList expects nodes. Same shape and
 * same rationale as TokenUsageRepository.findAggregatedByDateAndType in this
 * folder, which is the canonical company-scoped aggregation.
 *
 * EVERY traversal constrains its target label. The company traversal inherits
 * the label constraint from Neo4jService.initQuery()'s preamble, which binds
 * (company:Company {id: $companyId}); the target traversal below constrains
 * (grp:<AllowlistedLabel>). The write bug fixed in tokenusage.repository.ts left
 * label-less nodes on exactly these relationships, and an unconstrained match
 * returns them.
 *
 * It does NOT override onModuleInit: the :TokenUsage indexes belong to
 * TokenUsageRepository, and duplicating the CREATE INDEX would be a second
 * writer for one schema object.
 */
@Injectable()
export class TokenUsageReportRepository extends AbstractRepository<
  TokenUsage,
  typeof TokenUsageDescriptor.relationships
> {
  protected readonly descriptor = TokenUsageDescriptor;

  constructor(
    neo4j: Neo4jService,
    securityService: SecurityService,
    clsService: ClsService,
    @Optional() @Inject(TOKEN_USAGE_TARGET_LABELS) private readonly targetLabels: TokenUsageTargetLabel[] = [],
  ) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Two rows: the requested window and the equal-length span immediately
   * preceding it, which is what the KPI tile's delta is measured against.
   *
   * Both rows are ALWAYS returned, zero-filled when the database has nothing —
   * the tiles then never have to branch on a missing window.
   */
  async findSummary(params: { from: string; to: string }): Promise<TokenUsageReportSummaryEntity[]> {
    const span = new Date(params.to).getTime() - new Date(params.from).getTime();
    const previousFrom = new Date(new Date(params.from).getTime() - span).toISOString();

    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, from: params.from, to: params.to, previousFrom };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${NODE}.createdAt >= datetime($previousFrom) AND ${NODE}.createdAt <= datetime($to)

      WITH ${NODE},
           CASE WHEN ${NODE}.createdAt >= datetime($from) THEN 'current' ELSE 'previous' END AS window

      RETURN window                                       AS window,
             ${this._metricProjection()}
    `;

    const result = await this.neo4j.read(query.query, query.queryParams); // nja-lint-ignore: buildDefaultMatch()-scoped scalar aggregation — non-entity shape

    const found = new Map<string, TokenUsageReportSummaryEntity>();
    for (const record of result.records as any[]) {
      // nja-lint-ignore: aggregation rows, not entity nodes
      const window = record.get("window") as string;
      found.set(window, { id: window, window, ...this._metrics(record) } as TokenUsageReportSummaryEntity);
    }

    return ["current", "previous"].map(
      (window) =>
        found.get(window) ??
        ({
          id: window,
          window,
          cost: 0,
          credits: 0,
          tokensIn: 0,
          tokensOut: 0,
          cached: 0,
          calls: 0,
        } as TokenUsageReportSummaryEntity),
    );
  }

  /**
   * One row per (bucket, operation type). `stackBy` is accepted for signature
   * parity with the administrative timeline but only "type" is meaningful inside
   * a single tenant, so it is not interpolated anywhere.
   */
  async findTimeline(params: {
    from: string;
    to: string;
    granularity: "day" | "week" | "month";
    stackBy: "type";
  }): Promise<TokenUsageReportTimelineEntity[]> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, from: params.from, to: params.to };

    const unit = params.granularity === "day" ? undefined : TRUNCATION_UNITS[params.granularity];
    const bucketExpression = unit ? `date.truncate('${unit}', date(${NODE}.createdAt))` : `date(${NODE}.createdAt)`;

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${NODE}.createdAt >= datetime($from) AND ${NODE}.createdAt <= datetime($to)

      WITH ${NODE},
           ${bucketExpression}          AS bucket,
           ${NODE}.tokenUsageType       AS series

      RETURN toString(bucket)                             AS bucket,
             series                                       AS series,
             ${this._metricProjection()}
      ORDER BY bucket ASC, series ASC
    `;

    const result = await this.neo4j.read(query.query, query.queryParams); // nja-lint-ignore: buildDefaultMatch()-scoped scalar aggregation — non-entity shape

    return (result.records as any[]).map((record) => {
      // nja-lint-ignore: aggregation rows, not entity nodes
      const bucket = record.get("bucket") as string;
      const series = record.get("series") as string;
      return {
        id: `${bucket}|${series}`,
        bucket,
        series,
        ...this._metrics(record),
      } as TokenUsageReportTimelineEntity;
    });
  }

  /**
   * Ranked rows for one dimension, ordered by the SELECTED metric.
   *
   * Ordering by the selected metric rather than unconditionally by cost is not
   * cosmetic: credits are max(minCreditsPerRecord, round4(cost / creditCost)),
   * and that floor breaks proportionality for cheap calls — so a credits panel
   * ranked by cost is visibly mis-ordered whenever the two diverge.
   *
   * Everything past `limit` is folded into a single "other" row so the shares
   * still sum to 100 percent.
   */
  async findBreakdown(params: {
    from: string;
    to: string;
    dimension: TokenUsageReportDimension;
    targetLabel?: string;
    metric: TokenUsageReportMetric;
    limit: number;
  }): Promise<TokenUsageReportBreakdownEntity[]> {
    let grouping: string;
    let projection: string;

    if (params.dimension === "target") {
      // Label and relationship types come from the allowlist, not the request —
      // see _resolveTarget and normaliseTargetLabel.
      grouping = buildTargetGrouping({
        target: this._resolveTarget(params.targetLabel),
        nodeName: NODE,
        carried: [],
      });
      projection = `
             grp.id                        AS id,
             coalesce(grp.name, grp.title) AS label,
             null                          AS sublabel,`;
    } else {
      grouping = `WITH ${NODE}, ${NODE}.tokenUsageType AS grp`;
      projection = `
             grp                           AS id,
             grp                           AS label,
             null                          AS sublabel,`;
    }

    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, from: params.from, to: params.to };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${NODE}.createdAt >= datetime($from) AND ${NODE}.createdAt <= datetime($to)
      ${grouping}

      RETURN ${projection}
             ${this._metricProjection()}
      ORDER BY ${ORDER_COLUMNS[params.metric]} DESC
    `;

    const result = await this.neo4j.read(query.query, query.queryParams); // nja-lint-ignore: buildDefaultMatch()-scoped scalar aggregation — non-entity shape

    const all: TokenUsageReportBreakdownEntity[] = (result.records as any[]).map((record) => {
      // nja-lint-ignore: aggregation rows, not entity nodes
      const sublabel = record.get("sublabel");
      return {
        id: (record.get("id") as string) ?? "unknown",
        label: (record.get("label") as string) ?? (record.get("id") as string) ?? "unknown",
        ...(sublabel ? { sublabel: sublabel as string } : {}),
        ...this._metrics(record),
      } as TokenUsageReportBreakdownEntity;
    });

    if (all.length <= params.limit) return all;

    const kept = all.slice(0, params.limit);
    const folded = all.slice(params.limit);

    kept.push({
      id: "other",
      label: "other",
      cost: folded.reduce((sum, row) => sum + row.cost, 0),
      credits: folded.reduce((sum, row) => sum + row.credits, 0),
      tokensIn: folded.reduce((sum, row) => sum + row.tokensIn, 0),
      tokensOut: folded.reduce((sum, row) => sum + row.tokensOut, 0),
      cached: folded.reduce((sum, row) => sum + row.cached, 0),
      calls: folded.reduce((sum, row) => sum + row.calls, 0),
    } as TokenUsageReportBreakdownEntity);

    return kept;
  }

  /**
   * The six metric columns, identical in all three queries.
   *
   * `tokens` is projected as a column of its own so ORDER BY can name it — a
   * Cypher ORDER BY cannot reference an expression built from two aggregates
   * unless that expression is itself projected.
   */
  private _metricProjection(): string {
    return `
             sum(toFloat(${NODE}.cost))                  AS cost,
             sum(toFloat(${NODE}.credits))               AS credits,
             sum(toInteger(${NODE}.inputTokens))         AS tokensIn,
             sum(toInteger(${NODE}.outputTokens))        AS tokensOut,
             sum(toInteger(${NODE}.cachedInputTokens))   AS cached,
             count(${NODE})                              AS calls,
             sum(toInteger(${NODE}.inputTokens)) + sum(toInteger(${NODE}.outputTokens)) AS tokens`;
  }

  private _metrics(record: any): {
    cost: number;
    credits: number;
    tokensIn: number;
    tokensOut: number;
    cached: number;
    calls: number;
  } {
    return {
      cost: this.toNumber(record.get("cost")),
      credits: this.toNumber(record.get("credits")),
      tokensIn: this.toNumber(record.get("tokensIn")),
      tokensOut: this.toNumber(record.get("tokensOut")),
      cached: this.toNumber(record.get("cached")),
      calls: this.toNumber(record.get("calls")),
    };
  }

  /**
   * Resolves the requested label against the host application's allowlist and
   * returns the ALLOWLIST'S OWN string, never the caller's. An empty allowlist
   * means the app never opted in, so every target request is refused.
   */
  private _resolveTarget(requested: string | undefined): ResolvedTokenUsageTarget {
    const available = this.targetLabels.map(normaliseTargetLabel);
    const match = available.find((target) => target.label === requested);
    if (!match)
      throw new BadRequestException(
        available.length === 0
          ? "dimension=target is not enabled for this application"
          : `targetLabel must be one of ${available.map((target) => target.label).join(", ")}`,
      );
    return match;
  }

  /**
   * Neo4j hands integers back as driver Integer objects. Same helper, same
   * shape, as TokenUsageRepository.toNumber — AbstractRepository does not
   * provide one, and the aggregation path is the only place that needs it.
   */
  private toNumber(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === "number") return value;
    if (typeof value.toNumber === "function") return value.toNumber();
    return Number(value) || 0;
  }
}
