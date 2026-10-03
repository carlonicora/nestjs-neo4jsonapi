import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AnalyticsDailySummary, AnalyticsDailySummaryDescriptor } from "../entities/analytics-daily-summary";
import { analyticsPageViewMeta } from "../entities/analytics-page-view.meta";
import { analyticsSessionMeta } from "../entities/analytics-session.meta";

type SummaryRow = {
  id: string;
  section: string;
  dimension: string;
  key: string;
  visitors: number;
  sessions: number;
  pageViews: number;
};

const toNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof (v as { toNumber?: () => number }).toNumber === "function")
    return (v as { toNumber: () => number }).toNumber();
  return Number(v) || 0;
};

const S = analyticsSessionMeta.nodeName; // "analyticsSession"
const PV = analyticsPageViewMeta.nodeName; // "analyticsPageView"

/** Key for a session with no value for a dimension; must match AnalyticsAdminRepository's coalesce. */
const NONE_KEY = "(none)";

/**
 * Daily roll-ups written by the retention job before a day's raw sessions and
 * page views are deleted. Platform-level, written outside HTTP/CLS context.
 *
 * The aggregate reads RETURN scalar columns, not graph nodes, so
 * readOne()/readMany() cannot map them; they read the columns off the driver
 * result, the same shape and rationale as TokenUsageAdminRepository.
 */
@Injectable()
export class AnalyticsDailySummaryRepository extends AbstractRepository<
  AnalyticsDailySummary,
  typeof AnalyticsDailySummaryDescriptor.relationships
> {
  protected readonly descriptor = AnalyticsDailySummaryDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /** Adds the (date, dimension) index on top of the id constraint AbstractRepository creates from the descriptor. */
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();

    const { nodeName, labelName } = this.descriptor.model;

    await this.neo4j.writeOne({
      query: `CREATE INDEX ${nodeName}_date_dimension IF NOT EXISTS FOR (${nodeName}:${labelName}) ON (${nodeName}.date, ${nodeName}.dimension)`,
    });
  }

  /**
   * MERGEs one row per (section, dimension, key) for the sessions that started
   * on `date`: `total` plus source, medium, campaign, referrer and landing from
   * the sessions, and route from their page views. Sessions without a value for
   * a dimension (no UTM, no external referrer) are written under the key
   * '(none)', the same key AnalyticsAdminRepository's breakdown uses for raw
   * rows, so raw and summarised rows merge.
   *
   * Every property is set ON CREATE only, so an existing row is never
   * overwritten. That keeps a re-run idempotent after a crash part-way through
   * the raw delete: the next night's rollup sees only the sessions that
   * survived, and a plain SET would replace the stored totals with those
   * smaller counts.
   * Returns the number of rows written.
   */
  async rollupDay(params: { date: string }): Promise<number> {
    const sessionResult = await this.neo4j.read(
      `
        MATCH (${S}:${analyticsSessionMeta.labelName})
        WHERE date(${S}.startedAt) = date($date)
        UNWIND [
          ['total', ''],
          ['source', coalesce(${S}.utmSource, $noneKey)],
          ['medium', coalesce(${S}.utmMedium, $noneKey)],
          ['campaign', coalesce(${S}.utmCampaign, $noneKey)],
          ['referrer', coalesce(${S}.referrerHost, $noneKey)],
          ['landing', coalesce(${S}.landingRoute, $noneKey)]
        ] AS pair
        WITH ${S}, pair[0] AS dimension, pair[1] AS key
        RETURN ${S}.section AS section,
          dimension,
          key,
          count(DISTINCT ${S}.visitorId) AS visitors,
          count(DISTINCT ${S}) AS sessions,
          sum(${S}.pageViews) AS pageViews
      `,
      { date: params.date, noneKey: NONE_KEY },
    );

    const pageViewResult = await this.neo4j.read(
      `
        MATCH (${PV}:${analyticsPageViewMeta.labelName})-[:IN_SESSION]->(${S}:${analyticsSessionMeta.labelName})
        WHERE date(${S}.startedAt) = date($date)
        RETURN ${PV}.section AS section,
          'route' AS dimension,
          ${PV}.route AS key,
          count(DISTINCT ${S}.visitorId) AS visitors,
          count(DISTINCT ${S}) AS sessions,
          count(${PV}) AS pageViews
      `,
      { date: params.date },
    );

    const rows: SummaryRow[] = [...sessionResult.records, ...pageViewResult.records].map((r: any) => {
      const section = r.get("section") as string;
      const dimension = r.get("dimension") as string;
      const key = (r.get("key") as string) ?? "";
      return {
        id: `${params.date}|${section}|${dimension}|${key}`,
        section,
        dimension,
        key,
        visitors: toNumber(r.get("visitors")),
        sessions: toNumber(r.get("sessions")),
        pageViews: toNumber(r.get("pageViews")),
      };
    });

    if (rows.length === 0) return 0;

    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, date: params.date, rows };
    query.query = `
      UNWIND $rows AS row
      MERGE (${nodeName}:${labelName} {id: row.id})
      ON CREATE SET
        ${nodeName}.date = date(left($date, 10)),
        ${nodeName}.section = row.section,
        ${nodeName}.dimension = row.dimension,
        ${nodeName}.key = row.key,
        ${nodeName}.visitors = row.visitors,
        ${nodeName}.sessions = row.sessions,
        ${nodeName}.pageViews = row.pageViews,
        ${nodeName}.createdAt = datetime(),
        ${nodeName}.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);

    return rows.length;
  }
}
