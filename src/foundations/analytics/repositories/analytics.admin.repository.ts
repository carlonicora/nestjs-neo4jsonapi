// nja-lint-ignore-file: cross-tenant administrative read repository.
//
// Every query here deliberately omits buildDefaultMatch(): that helper scopes to
// the CALLER's company via CLS, which is exactly wrong for a platform-wide admin
// dashboard — and the analytics labels are platform-level anyway
// (isCompanyScoped: false, no BELONGS_TO). Access is gated instead by the
// controller's JwtAuthGuard + @Roles(Administrator) (see
// analytics.admin.controller.ts). Rollup RETURNs are scalar columns, not graph
// nodes, so readOne()/readMany() cannot map them — entityFactory.createGraphList
// expects nodes. Same shape and same rationale as
// foundations/tokenusage/repositories/tokenusage.admin.repository.ts.
//
// For the same reason it also does NOT call Neo4jService.initQuery() — that
// helper prepends its own CLS-scoped company MATCH, which is the same scoping
// through a less obvious door. Every query here seeds itself from _adminQuery()
// instead; see that method for the outage it caused in the token-usage
// dashboard (ADM-53..57). No query here binds a parameter named `companyId`.
//
// The architecture gate raises a FILE-LEVEL manual-query-no-company-scope finding
// on this shape; per-line ignores do not clear it, so this header note is the
// documented resolution.
import { BadRequestException, Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { convertFieldValue } from "../../../common/helpers/define-entity";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AnalyticsBreakdownEntity } from "../entities/analytics-breakdown";
import { analyticsDailySummaryMeta } from "../entities/analytics-daily-summary.meta";
import { analyticsPageViewMeta } from "../entities/analytics-page-view.meta";
import { AnalyticsSession, AnalyticsSessionDescriptor } from "../entities/analytics-session";
import { analyticsSessionMeta } from "../entities/analytics-session.meta";
import { AnalyticsSummaryEntity } from "../entities/analytics-summary";
import { AnalyticsTimelineDescriptor, AnalyticsTimelineEntity } from "../entities/analytics-timeline";

/**
 * The closed sets of values the admin endpoints accept. The controller
 * validates query params against these tuples and the unions below are derived
 * from them, so there is one declaration of each set.
 */
export const SECTIONS = ["all", "public", "app"] as const;
export const GRANULARITIES = ["day", "week", "month"] as const;
export const DIMENSIONS = ["source", "medium", "campaign", "referrer", "route", "landing"] as const;

export type Section = (typeof SECTIONS)[number];
export type Granularity = (typeof GRANULARITIES)[number];
export type Dimension = (typeof DIMENSIONS)[number];

const SESSION = analyticsSessionMeta.nodeName; // "analyticsSession"
const PAGE_VIEW = analyticsPageViewMeta.nodeName; // "analyticsPageView"
const SUMMARY = analyticsDailySummaryMeta.nodeName; // "analyticsDailySummary"

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

/**
 * The section filter each accepted value binds. `all` binds nothing and adds no
 * predicate; the other two are echoed from this table, never from the request.
 */
const SECTION_FILTERS: Record<Section, string | null> = {
  all: null,
  public: "public",
  app: "app",
};

/**
 * The key expression each breakdown dimension may emit, and the label it reads.
 * Session-based dimensions read the first page view's attribution stored on the
 * session; `route` reads every page view. Missing attribution groups under
 * `(none)` — the same key the nightly rollup writes, so raw and summarised rows
 * merge on it.
 */
const DIMENSION_SPECS: Record<Dimension, { reads: "session" | "pageView"; key: string }> = {
  source: { reads: "session", key: `coalesce(${SESSION}.utmSource, '(none)')` },
  medium: { reads: "session", key: `coalesce(${SESSION}.utmMedium, '(none)')` },
  campaign: { reads: "session", key: `coalesce(${SESSION}.utmCampaign, '(none)')` },
  referrer: { reads: "session", key: `coalesce(${SESSION}.referrerHost, '(none)')` },
  landing: { reads: "session", key: `coalesce(${SESSION}.landingRoute, '(none)')` },
  route: { reads: "pageView", key: `coalesce(${PAGE_VIEW}.route, '(none)')` },
};

/** The shared metric field set every admin resource exposes. */
type AnalyticsMetrics = {
  visitors: number;
  sessions: number;
  pageViews: number;
};

/** Per-section totals for one window, before the derived ratios. */
type SectionTotals = AnalyticsMetrics & {
  section: string;
  /** Distinct visitors in the RAW part only — summaries carry no consent split. */
  rawVisitors: number;
  consentedVisitors: number;
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
 * Platform-wide reporting queries behind /analytics/administration/*.
 *
 * Extends AbstractRepository for the shared Neo4j/security/CLS plumbing and the
 * descriptor typing; none of the inherited finders are used, for the reasons in
 * the file header, and it deliberately does NOT override onModuleInit — the
 * analytics indexes belong to the session, page-view and daily-summary
 * repositories.
 *
 * Every aggregate is two reads merged in JS: the RAW part (sessions / page views
 * on or after `retentionCutoff`) and the SUMMARISED part (daily summaries before
 * it). Raw visitors are `count(DISTINCT visitorId)`; summarised visitors are the
 * stored per-day distinct counts, summed — so a multi-day bucket over summarised
 * data sums daily distinct visitors. The summary adds a third raw read for the
 * cross-section visitor total (see _sectionTotals).
 */
@Injectable()
export class AnalyticsAdminRepository extends AbstractRepository<
  AnalyticsSession,
  typeof AnalyticsSessionDescriptor.relationships
> {
  protected readonly descriptor = AnalyticsSessionDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Six rows: {public, app, total} × {current, previous}. The previous window is
   * the equal-length span immediately preceding `from`, which is what the KPI
   * tiles' deltas are computed against.
   */
  async findSummary(params: {
    from: string;
    to: string;
    section: Section;
    retentionCutoff: string;
  }): Promise<AnalyticsSummaryEntity[]> {
    const section = this._section(params.section);
    const previous = this._previousWindow(params.from, params.to);

    const [current, prior] = await Promise.all([
      this._sectionTotals({ from: params.from, to: params.to, section, retentionCutoff: params.retentionCutoff }),
      this._sectionTotals({ from: previous.from, to: previous.to, section, retentionCutoff: params.retentionCutoff }),
    ]);

    return [...this._withTotal(current, "current"), ...this._withTotal(prior, "previous")];
  }

  async findTimeline(params: {
    from: string;
    to: string;
    section: Section;
    granularity: Granularity;
    retentionCutoff: string;
  }): Promise<AnalyticsTimelineEntity[]> {
    const section = this._section(params.section);
    // Cypher accepts a parameter for date.truncate's unit (verified against
    // DozerDB 5.26), so the granularity is bound rather than interpolated —
    // the "always parameterised, never interpolated" guardrail applies here
    // even though _truncationUnit() already whitelists the value.
    const granularity = params.granularity === "day" ? null : this._truncationUnit(params.granularity);

    const seed = {
      from: params.from,
      to: params.to,
      retentionCutoff: params.retentionCutoff,
      section,
      granularity,
    };

    const raw = this._adminQuery(seed);
    const rawBucket =
      granularity === null ? `date(${SESSION}.startedAt)` : `date.truncate($granularity, ${SESSION}.startedAt)`;

    raw.query = `
      MATCH (${SESSION}:${analyticsSessionMeta.labelName})
      WHERE ${this._rawSessionWindow()}
      ${section === null ? "" : `AND ${SESSION}.section = $section`}
      WITH ${rawBucket} AS bucket, ${SESSION}
      RETURN bucket                                  AS bucket,
             count(DISTINCT ${SESSION}.visitorId)    AS visitors,
             count(${SESSION})                       AS sessions,
             sum(toInteger(${SESSION}.pageViews))    AS pageViews
      ORDER BY bucket ASC
    `;

    const summarised = this._adminQuery(seed);
    const summaryBucket = granularity === null ? `${SUMMARY}.date` : `date.truncate($granularity, ${SUMMARY}.date)`;

    summarised.query = `
      MATCH (${SUMMARY}:${analyticsDailySummaryMeta.labelName} {dimension: 'total'})
      WHERE ${this._summaryWindow()}
      ${section === null ? "" : `AND ${SUMMARY}.section = $section`}
      WITH ${summaryBucket} AS bucket, ${SUMMARY}
      RETURN bucket                                  AS bucket,
             sum(toInteger(${SUMMARY}.visitors))     AS visitors,
             sum(toInteger(${SUMMARY}.sessions))     AS sessions,
             sum(toInteger(${SUMMARY}.pageViews))    AS pageViews
      ORDER BY bucket ASC
    `;

    const [rawResult, summaryResult] = await Promise.all([
      this.neo4j.read(raw.query, raw.queryParams),
      this.neo4j.read(summarised.query, summarised.queryParams),
    ]);

    // The driver hands back a native Neo4j Date. convertFieldValue is the
    // framework's single implementation of the descriptor-typed read-path
    // conversion — the same one the auto-generated mapper() uses. Never
    // toString() it in Cypher, never re-format it here. The field type is read
    // off the descriptor so the two can never drift.
    const bucketType = AnalyticsTimelineDescriptor.fields.bucket?.type ?? "date";

    const merged = new Map<string, AnalyticsMetrics>();
    for (const r of [...summaryResult.records, ...rawResult.records] as any[]) {
      const bucketValue = convertFieldValue(r.get("bucket"), bucketType) as string;
      merged.set(bucketValue, this._add(merged.get(bucketValue), this._metrics(r)));
    }

    return [...merged.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([bucketValue, metrics]) =>
          ({
            id: `${bucketValue}|${params.section}`,
            bucket: bucketValue,
            section: params.section,
            ...metrics,
          }) as AnalyticsTimelineEntity,
      );
  }

  /**
   * Ranked rows, descending by visitors, truncated to `limit` with the exact
   * remainder folded into a single "other" row. The full ordered set is fetched
   * and sliced in JS so the remainder is exact rather than a second query's
   * approximation.
   */
  async findBreakdown(params: {
    from: string;
    to: string;
    section: Section;
    dimension: Dimension;
    limit: number;
    retentionCutoff: string;
  }): Promise<AnalyticsBreakdownEntity[]> {
    const section = this._section(params.section);
    const { dimension, spec } = this._dimension(params.dimension);

    const seed = { from: params.from, to: params.to, retentionCutoff: params.retentionCutoff, section, dimension };

    const raw = this._adminQuery(seed);

    if (spec.reads === "pageView") {
      raw.query = `
      MATCH (${PAGE_VIEW}:${analyticsPageViewMeta.labelName})-[:IN_SESSION]->(${SESSION}:${analyticsSessionMeta.labelName})
      WHERE ${PAGE_VIEW}.createdAt >= datetime($from) AND ${PAGE_VIEW}.createdAt <= datetime($to)
      AND date(${PAGE_VIEW}.createdAt) >= date($retentionCutoff)
      ${section === null ? "" : `AND ${PAGE_VIEW}.section = $section`}
      WITH ${spec.key} AS key, ${PAGE_VIEW}, ${SESSION}
      RETURN key                                     AS key,
             count(DISTINCT ${SESSION}.visitorId)    AS visitors,
             count(DISTINCT ${SESSION})              AS sessions,
             count(${PAGE_VIEW})                     AS pageViews
      `;
    } else {
      raw.query = `
      MATCH (${SESSION}:${analyticsSessionMeta.labelName})
      WHERE ${this._rawSessionWindow()}
      ${section === null ? "" : `AND ${SESSION}.section = $section`}
      WITH ${spec.key} AS key, ${SESSION}
      RETURN key                                     AS key,
             count(DISTINCT ${SESSION}.visitorId)    AS visitors,
             count(${SESSION})                       AS sessions,
             sum(toInteger(${SESSION}.pageViews))    AS pageViews
      `;
    }

    const summarised = this._adminQuery(seed);
    summarised.query = `
      MATCH (${SUMMARY}:${analyticsDailySummaryMeta.labelName})
      WHERE ${SUMMARY}.dimension = $dimension
      AND ${this._summaryWindow()}
      ${section === null ? "" : `AND ${SUMMARY}.section = $section`}
      RETURN ${SUMMARY}.key                          AS key,
             sum(toInteger(${SUMMARY}.visitors))     AS visitors,
             sum(toInteger(${SUMMARY}.sessions))     AS sessions,
             sum(toInteger(${SUMMARY}.pageViews))    AS pageViews
    `;

    const [rawResult, summaryResult] = await Promise.all([
      this.neo4j.read(raw.query, raw.queryParams),
      this.neo4j.read(summarised.query, summarised.queryParams),
    ]);

    const merged = new Map<string, AnalyticsMetrics>();
    for (const r of [...rawResult.records, ...summaryResult.records] as any[]) {
      const key = (r.get("key") as string) ?? "(none)";
      merged.set(key, this._add(merged.get(key), this._metrics(r)));
    }

    const all: AnalyticsBreakdownEntity[] = [...merged.entries()]
      .sort(
        ([ka, a], [kb, b]) => b.visitors - a.visitors || b.pageViews - a.pageViews || (ka < kb ? -1 : ka > kb ? 1 : 0),
      )
      .map(([key, metrics]) => ({ id: `${dimension}|${key}`, dimension, key, ...metrics }) as AnalyticsBreakdownEntity);

    if (all.length <= params.limit) return all;

    const top = all.slice(0, params.limit);
    const tail = all.slice(params.limit);

    const other = {
      id: `${dimension}|other`,
      dimension,
      key: "other",
      visitors: tail.reduce((s, r) => s + r.visitors, 0),
      sessions: tail.reduce((s, r) => s + r.sessions, 0),
      pageViews: tail.reduce((s, r) => s + r.pageViews, 0),
    } as AnalyticsBreakdownEntity;

    return [...top, other];
  }

  /**
   * Raw + summarised totals split by section for one window, plus the window's
   * total visitor count.
   *
   * `totalVisitors` cannot be the sum of the two sections: one visitor with
   * sessions in both public and app would count twice. Its raw part is a third
   * read with no section grouping (`count(DISTINCT visitorId)` across both); its
   * summarised part is the stored per-day `total` rows summed, as for the
   * sections, because summaries keep no visitor ids to de-duplicate.
   */
  private async _sectionTotals(params: {
    from: string;
    to: string;
    section: string | null;
    retentionCutoff: string;
  }): Promise<{ sections: SectionTotals[]; totalVisitors: number }> {
    const raw = this._adminQuery(params);
    raw.query = `
      MATCH (${SESSION}:${analyticsSessionMeta.labelName})
      WHERE ${this._rawSessionWindow()}
      ${params.section === null ? "" : `AND ${SESSION}.section = $section`}
      RETURN ${SESSION}.section                      AS section,
             count(DISTINCT ${SESSION}.visitorId)    AS visitors,
             count(DISTINCT CASE WHEN ${SESSION}.consented THEN ${SESSION}.visitorId END) AS consentedVisitors,
             count(${SESSION})                       AS sessions,
             sum(toInteger(${SESSION}.pageViews))    AS pageViews
    `;

    const summarised = this._adminQuery(params);
    summarised.query = `
      MATCH (${SUMMARY}:${analyticsDailySummaryMeta.labelName} {dimension: 'total'})
      WHERE ${this._summaryWindow()}
      ${params.section === null ? "" : `AND ${SUMMARY}.section = $section`}
      RETURN ${SUMMARY}.section                      AS section,
             sum(toInteger(${SUMMARY}.visitors))     AS visitors,
             sum(toInteger(${SUMMARY}.sessions))     AS sessions,
             sum(toInteger(${SUMMARY}.pageViews))    AS pageViews
    `;

    const distinct = this._adminQuery(params);
    distinct.query = `
      MATCH (${SESSION}:${analyticsSessionMeta.labelName})
      WHERE ${this._rawSessionWindow()}
      ${params.section === null ? "" : `AND ${SESSION}.section = $section`}
      RETURN count(DISTINCT ${SESSION}.visitorId)    AS distinctVisitors
    `;

    const [rawResult, summaryResult, distinctResult] = await Promise.all([
      this.neo4j.read(raw.query, raw.queryParams),
      this.neo4j.read(summarised.query, summarised.queryParams),
      this.neo4j.read(distinct.query, distinct.queryParams),
    ]);

    let totalVisitors = (distinctResult.records as any[]).reduce(
      (sum, r) => sum + toNumber(r.get("distinctVisitors")),
      0,
    );

    const bySection = new Map<string, SectionTotals>();
    const entry = (section: string): SectionTotals => {
      const existing = bySection.get(section);
      if (existing) return existing;
      const created = { section, visitors: 0, sessions: 0, pageViews: 0, rawVisitors: 0, consentedVisitors: 0 };
      bySection.set(section, created);
      return created;
    };

    for (const r of rawResult.records as any[]) {
      const row = entry(r.get("section") as string);
      const metrics = this._metrics(r);
      row.visitors += metrics.visitors;
      row.sessions += metrics.sessions;
      row.pageViews += metrics.pageViews;
      row.rawVisitors += metrics.visitors;
      row.consentedVisitors += toNumber(r.get("consentedVisitors"));
    }

    for (const r of summaryResult.records as any[]) {
      const row = entry(r.get("section") as string);
      const metrics = this._metrics(r);
      row.visitors += metrics.visitors;
      row.sessions += metrics.sessions;
      row.pageViews += metrics.pageViews;
      totalVisitors += metrics.visitors;
    }

    return { sections: [...bySection.values()], totalVisitors };
  }

  /**
   * Guarantees both sections are present (zero-filled when a window has no
   * rows) and appends the "total" section, so the tiles never have to branch on
   * a missing row. Total sessions and page views are the sections' sum; total
   * visitors is the de-duplicated count from _sectionTotals. Consent share is
   * measured on the raw part only: daily summaries carry no consent split.
   */
  private _withTotal(
    totals: { sections: SectionTotals[]; totalVisitors: number },
    window: string,
  ): AnalyticsSummaryEntity[] {
    const rows = totals.sections;
    const find = (section: string): SectionTotals =>
      rows.find((r) => r.section === section) ?? {
        section,
        visitors: 0,
        sessions: 0,
        pageViews: 0,
        rawVisitors: 0,
        consentedVisitors: 0,
      };

    const publicRow = find("public");
    const appRow = find("app");

    const total: SectionTotals = {
      section: "total",
      visitors: totals.totalVisitors,
      sessions: publicRow.sessions + appRow.sessions,
      pageViews: publicRow.pageViews + appRow.pageViews,
      rawVisitors: publicRow.rawVisitors + appRow.rawVisitors,
      consentedVisitors: publicRow.consentedVisitors + appRow.consentedVisitors,
    };

    return [publicRow, appRow, total].map((r) => ({
      id: `${r.section}|${window}`,
      section: r.section,
      window,
      visitors: r.visitors,
      sessions: r.sessions,
      pageViews: r.pageViews,
      pagesPerSession: r.sessions === 0 ? 0 : round(r.pageViews / r.sessions, 2),
      consentShare: r.rawVisitors === 0 ? 0 : round(r.consentedVisitors / r.rawVisitors, 4),
    })) as AnalyticsSummaryEntity[];
  }

  /** Raw sessions inside the request range and on or after the retention cutoff. */
  private _rawSessionWindow(): string {
    return `${SESSION}.startedAt >= datetime($from) AND ${SESSION}.startedAt <= datetime($to)
      AND date(${SESSION}.startedAt) >= date($retentionCutoff)`;
  }

  /** Summarised days inside the request range and before the retention cutoff. */
  private _summaryWindow(): string {
    return `${SUMMARY}.date >= date(datetime($from)) AND ${SUMMARY}.date <= date(datetime($to))
      AND ${SUMMARY}.date < date($retentionCutoff)`;
  }

  /**
   * The query seed every aggregation in this file MUST use.
   *
   * It deliberately does NOT call `Neo4jService.initQuery()`. initQuery()
   * PREPENDS `MATCH (company:Company {id: $companyId})` (plus a currentUser
   * match hanging off it) whenever the CALLER's CLS session carries a
   * `companyId` — the same CLS scoping the file header explains this dashboard
   * must not have, reintroduced through a less obvious door than
   * buildDefaultMatch().
   *
   * Reachable only for an Administrator who ALSO belongs to a company (CLS has
   * no companyId otherwise), which is exactly the dual-role shape the platform
   * admin fixture — and real deployments — have. In the token-usage dashboard
   * that prepended MATCH reduced every aggregation to zero rows and the
   * zero-fill rendered a successful, empty page (ADM-53..57).
   *
   * Analytics nodes have no company at all, so this seed binds no `companyId`
   * parameter of any kind. `section`, `granularity` and `dimension` are bound
   * only when the caller supplies them, and only with values echoed from this
   * file's lookup tables.
   */
  private _adminQuery(params: {
    from: string;
    to: string;
    retentionCutoff: string;
    section?: string | null;
    granularity?: string | null;
    dimension?: string;
  }): {
    query: string;
    queryParams: Record<string, unknown>;
  } {
    return {
      query: "",
      queryParams: {
        from: params.from,
        to: params.to,
        retentionCutoff: params.retentionCutoff,
        ...(params.section === undefined || params.section === null ? {} : { section: params.section }),
        ...(params.granularity === undefined ? {} : { granularity: params.granularity }),
        ...(params.dimension === undefined ? {} : { dimension: params.dimension }),
      },
    };
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
    const unit = Object.prototype.hasOwnProperty.call(TRUNCATION_UNITS, granularity)
      ? TRUNCATION_UNITS[granularity]
      : undefined;
    if (!unit) throw new BadRequestException(`Unsupported timeline granularity: ${granularity}`);
    return unit;
  }

  /**
   * Resolves the requested section to the value it binds (`null` for `all`).
   * Returns the TABLE'S OWN string, never the caller's.
   */
  private _section(section: Section): string | null {
    if (!Object.prototype.hasOwnProperty.call(SECTION_FILTERS, section))
      throw new BadRequestException(`section must be one of ${Object.keys(SECTION_FILTERS).join(", ")}`);
    return SECTION_FILTERS[section];
  }

  /**
   * Resolves the requested dimension against the whitelist. Returns the table's
   * own key and expression, never the caller's string.
   */
  private _dimension(requested: Dimension): {
    dimension: Dimension;
    spec: { reads: "session" | "pageView"; key: string };
  } {
    const dimension = DIMENSIONS.find((d) => d === requested);
    if (!dimension) throw new BadRequestException(`dimension must be one of ${DIMENSIONS.join(", ")}`);
    return { dimension, spec: DIMENSION_SPECS[dimension] };
  }

  private _add(a: AnalyticsMetrics | undefined, b: AnalyticsMetrics): AnalyticsMetrics {
    if (!a) return { ...b };
    return {
      visitors: a.visitors + b.visitors,
      sessions: a.sessions + b.sessions,
      pageViews: a.pageViews + b.pageViews,
    };
  }

  private _metrics(record: any): AnalyticsMetrics {
    return {
      visitors: toNumber(record.get("visitors")),
      sessions: toNumber(record.get("sessions")),
      pageViews: toNumber(record.get("pageViews")),
    };
  }
}
