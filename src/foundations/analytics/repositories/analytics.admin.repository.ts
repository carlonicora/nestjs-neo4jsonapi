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
import { userMeta } from "../../user/entities/user.meta";
import { Audience, AUDIENCES, Dimension, DIMENSIONS, Granularity } from "../common/analytics.admin.filters";
import { audienceOf } from "./analytics-audience.cypher";

const SESSION = analyticsSessionMeta.nodeName; // "analyticsSession"
const PAGE_VIEW = analyticsPageViewMeta.nodeName; // "analyticsPageView"
const SUMMARY = analyticsDailySummaryMeta.nodeName; // "analyticsDailySummary"
const USER = userMeta.nodeName; // "user"

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
 * The people column each audience counts. Site visitors are counted by their
 * anonymous visitor id; app users by the distinct BY_USER user, so one person
 * on two devices counts once. Every raw query binds the `user` alias through
 * the same OPTIONAL MATCH, so both expressions are always in scope.
 */
const PEOPLE: Record<Audience, string> = {
  visitors: `count(DISTINCT ${SESSION}.visitorId)`,
  users: `count(DISTINCT ${USER})`,
};

/** What a dimension reads to build its key. */
type DimensionReads = "session" | "pageView" | "exit";

/**
 * The key expression each breakdown dimension may emit, and what it reads.
 * Session-based dimensions read the first page view's attribution stored on the
 * session; `route` reads every page view; `exit` reads each session's last page
 * view (bound as `lastRoute`). Missing values group under `(none)`, the same key
 * the nightly rollup writes, so raw and summarised rows merge on it.
 */
const DIMENSION_SPECS: Record<Dimension, { reads: DimensionReads; key: string }> = {
  source: { reads: "session", key: `coalesce(${SESSION}.utmSource, '(none)')` },
  medium: { reads: "session", key: `coalesce(${SESSION}.utmMedium, '(none)')` },
  campaign: { reads: "session", key: `coalesce(${SESSION}.utmCampaign, '(none)')` },
  referrer: { reads: "session", key: `coalesce(${SESSION}.referrerHost, '(none)')` },
  landing: { reads: "session", key: `coalesce(${SESSION}.landingRoute, '(none)')` },
  route: { reads: "pageView", key: `coalesce(${PAGE_VIEW}.route, '(none)')` },
  exit: { reads: "exit", key: "coalesce(lastRoute, '(none)')" },
};

/** The shared metric field set every admin resource exposes. */
type AnalyticsMetrics = {
  visitors: number;
  sessions: number;
  pageViews: number;
};

/**
 * The number each breakdown is ranked by: attribution by people, pages by
 * views, entry and exit pages by the sessions that started or ended there.
 */
const RANK_BY: Record<Dimension, keyof AnalyticsMetrics> = {
  source: "visitors",
  medium: "visitors",
  campaign: "visitors",
  referrer: "visitors",
  route: "pageViews",
  landing: "sessions",
  exit: "sessions",
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
 * Every report reads ONE audience (site visitors or app users, see
 * analytics-audience.cypher.ts): raw sessions are filtered by the audience
 * expression, daily summaries by their stored `audience`. Every aggregate is two
 * reads merged in JS: the RAW part (sessions / page views on or after
 * `retentionCutoff`) and the SUMMARISED part (daily summaries before it). Raw
 * people are distinct visitor ids (visitors) or distinct users (users);
 * summarised people are the stored per-day distinct counts, summed — so a
 * multi-day bucket over summarised data sums daily distinct people.
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
   * Two rows for the audience: total × {current, previous}. The previous window
   * is the equal-length span immediately preceding `from`, which is what the
   * KPI tiles' deltas are computed against.
   */
  async findSummary(params: {
    from: string;
    to: string;
    audience: Audience;
    retentionCutoff: string;
  }): Promise<AnalyticsSummaryEntity[]> {
    const audience = this._audience(params.audience);
    const previous = this._previousWindow(params.from, params.to);

    return Promise.all([
      this._summaryRow(
        { from: params.from, to: params.to, audience, retentionCutoff: params.retentionCutoff },
        "current",
      ),
      this._summaryRow(
        { from: previous.from, to: previous.to, audience, retentionCutoff: params.retentionCutoff },
        "previous",
      ),
    ]);
  }

  async findTimeline(params: {
    from: string;
    to: string;
    audience: Audience;
    granularity: Granularity;
    retentionCutoff: string;
  }): Promise<AnalyticsTimelineEntity[]> {
    const audience = this._audience(params.audience);
    // Cypher accepts a parameter for date.truncate's unit (verified against
    // DozerDB 5.26), so the granularity is bound rather than interpolated —
    // the "always parameterised, never interpolated" guardrail applies here
    // even though _truncationUnit() already whitelists the value.
    const granularity = params.granularity === "day" ? null : this._truncationUnit(params.granularity);

    const seed = {
      from: params.from,
      to: params.to,
      retentionCutoff: params.retentionCutoff,
      audience,
      granularity,
    };

    const raw = this._adminQuery(seed);
    const rawBucket =
      granularity === null ? `date(${SESSION}.startedAt)` : `date.truncate($granularity, ${SESSION}.startedAt)`;

    raw.query = `
      MATCH (${SESSION}:${analyticsSessionMeta.labelName})
      WHERE ${this._rawSessionWindow()}
      AND ${audienceOf(SESSION)} = $audience
      OPTIONAL MATCH (${SESSION})-[:BY_USER]->(${USER}:${userMeta.labelName})
      WITH ${rawBucket} AS bucket, ${SESSION}, ${USER}
      RETURN bucket                                  AS bucket,
             ${PEOPLE[audience]} AS visitors,
             count(DISTINCT ${SESSION})              AS sessions,
             sum(toInteger(${SESSION}.pageViews))    AS pageViews
      ORDER BY bucket ASC
    `;

    const summarised = this._adminQuery(seed);
    const summaryBucket = granularity === null ? `${SUMMARY}.date` : `date.truncate($granularity, ${SUMMARY}.date)`;

    summarised.query = `
      MATCH (${SUMMARY}:${analyticsDailySummaryMeta.labelName} {dimension: 'total'})
      WHERE ${this._summaryWindow()}
      AND ${SUMMARY}.audience = $audience
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
            id: `${bucketValue}|${audience}`,
            bucket: bucketValue,
            section: audience,
            ...metrics,
          }) as AnalyticsTimelineEntity,
      );
  }

  /**
   * Ranked rows for one audience, descending by the dimension's own number
   * (RANK_BY), then people, then page views, then key; truncated to `limit`
   * with the exact remainder folded into a single "other" row. The full ordered
   * set is fetched and sliced in JS so the remainder is exact rather than a
   * second query's approximation.
   */
  async findBreakdown(params: {
    from: string;
    to: string;
    audience: Audience;
    dimension: Dimension;
    limit: number;
    retentionCutoff: string;
  }): Promise<AnalyticsBreakdownEntity[]> {
    const audience = this._audience(params.audience);
    const { dimension, spec } = this._dimension(params.dimension);

    const seed = { from: params.from, to: params.to, retentionCutoff: params.retentionCutoff, audience, dimension };

    const raw = this._adminQuery(seed);

    if (spec.reads === "pageView") {
      raw.query = `
      MATCH (${PAGE_VIEW}:${analyticsPageViewMeta.labelName})-[:IN_SESSION]->(${SESSION}:${analyticsSessionMeta.labelName})
      WHERE ${PAGE_VIEW}.createdAt >= datetime($from) AND ${PAGE_VIEW}.createdAt <= datetime($to)
      AND date(${PAGE_VIEW}.createdAt) >= date($retentionCutoff)
      AND ${audienceOf(SESSION)} = $audience
      OPTIONAL MATCH (${SESSION})-[:BY_USER]->(${USER}:${userMeta.labelName})
      WITH ${spec.key} AS key, ${PAGE_VIEW}, ${SESSION}, ${USER}
      RETURN key                                     AS key,
             ${PEOPLE[audience]} AS visitors,
             count(DISTINCT ${SESSION})              AS sessions,
             count(${PAGE_VIEW})                     AS pageViews
      `;
    } else if (spec.reads === "exit") {
      // A session's exit page is the route of its latest page view; a session
      // with no page view groups under (none). Windowed by session start, like
      // the other session dimensions.
      raw.query = `
      MATCH (${SESSION}:${analyticsSessionMeta.labelName})
      WHERE ${this._rawSessionWindow()}
      AND ${audienceOf(SESSION)} = $audience
      OPTIONAL MATCH (${SESSION})-[:BY_USER]->(${USER}:${userMeta.labelName})
      OPTIONAL MATCH (${PAGE_VIEW}:${analyticsPageViewMeta.labelName})-[:IN_SESSION]->(${SESSION})
      WITH ${SESSION}, ${USER}, ${PAGE_VIEW} ORDER BY ${PAGE_VIEW}.createdAt DESC
      WITH ${SESSION}, ${USER}, collect(${PAGE_VIEW}.route)[0] AS lastRoute
      WITH ${spec.key} AS key, ${SESSION}, ${USER}
      RETURN key                                     AS key,
             ${PEOPLE[audience]} AS visitors,
             count(DISTINCT ${SESSION})              AS sessions,
             sum(toInteger(${SESSION}.pageViews))    AS pageViews
      `;
    } else {
      raw.query = `
      MATCH (${SESSION}:${analyticsSessionMeta.labelName})
      WHERE ${this._rawSessionWindow()}
      AND ${audienceOf(SESSION)} = $audience
      OPTIONAL MATCH (${SESSION})-[:BY_USER]->(${USER}:${userMeta.labelName})
      WITH ${spec.key} AS key, ${SESSION}, ${USER}
      RETURN key                                     AS key,
             ${PEOPLE[audience]} AS visitors,
             count(DISTINCT ${SESSION})              AS sessions,
             sum(toInteger(${SESSION}.pageViews))    AS pageViews
      `;
    }

    const summarised = this._adminQuery(seed);
    summarised.query = `
      MATCH (${SUMMARY}:${analyticsDailySummaryMeta.labelName})
      WHERE ${SUMMARY}.dimension = $dimension
      AND ${this._summaryWindow()}
      AND ${SUMMARY}.audience = $audience
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

    const rankBy = RANK_BY[dimension];
    const all: AnalyticsBreakdownEntity[] = [...merged.entries()]
      .sort(
        ([ka, a], [kb, b]) =>
          b[rankBy] - a[rankBy] ||
          b.visitors - a.visitors ||
          b.pageViews - a.pageViews ||
          (ka < kb ? -1 : ka > kb ? 1 : 0),
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
   * One window's total row for the audience: raw + summarised people, sessions
   * and page views. Consent share is measured on the raw part only (daily
   * summaries carry no consent split) and always over visitor ids, the unit
   * consent is recorded against, whichever audience is counted as people.
   */
  private async _summaryRow(
    params: { from: string; to: string; audience: Audience; retentionCutoff: string },
    window: "current" | "previous",
  ): Promise<AnalyticsSummaryEntity> {
    const raw = this._adminQuery(params);
    raw.query = `
      MATCH (${SESSION}:${analyticsSessionMeta.labelName})
      WHERE ${this._rawSessionWindow()}
      AND ${audienceOf(SESSION)} = $audience
      OPTIONAL MATCH (${SESSION})-[:BY_USER]->(${USER}:${userMeta.labelName})
      WITH ${SESSION}, ${USER}
      RETURN ${PEOPLE[params.audience]} AS visitors,
             count(DISTINCT ${SESSION}.visitorId)    AS visitorIds,
             count(DISTINCT CASE WHEN ${SESSION}.consented THEN ${SESSION}.visitorId END) AS consentedVisitors,
             count(DISTINCT ${SESSION})              AS sessions,
             sum(toInteger(${SESSION}.pageViews))    AS pageViews
    `;

    const summarised = this._adminQuery(params);
    summarised.query = `
      MATCH (${SUMMARY}:${analyticsDailySummaryMeta.labelName} {dimension: 'total'})
      WHERE ${this._summaryWindow()}
      AND ${SUMMARY}.audience = $audience
      RETURN sum(toInteger(${SUMMARY}.visitors))     AS visitors,
             sum(toInteger(${SUMMARY}.sessions))     AS sessions,
             sum(toInteger(${SUMMARY}.pageViews))    AS pageViews
    `;

    const [rawResult, summaryResult] = await Promise.all([
      this.neo4j.read(raw.query, raw.queryParams),
      this.neo4j.read(summarised.query, summarised.queryParams),
    ]);

    let metrics: AnalyticsMetrics = { visitors: 0, sessions: 0, pageViews: 0 };
    let visitorIds = 0;
    let consentedVisitors = 0;

    for (const r of rawResult.records as any[]) {
      metrics = this._add(metrics, this._metrics(r));
      visitorIds += toNumber(r.get("visitorIds"));
      consentedVisitors += toNumber(r.get("consentedVisitors"));
    }
    for (const r of summaryResult.records as any[]) metrics = this._add(metrics, this._metrics(r));

    return {
      id: `total|${window}`,
      section: "total",
      window,
      visitors: metrics.visitors,
      sessions: metrics.sessions,
      pageViews: metrics.pageViews,
      pagesPerSession: metrics.sessions === 0 ? 0 : round(metrics.pageViews / metrics.sessions, 2),
      consentShare: visitorIds === 0 ? 0 : round(consentedVisitors / visitorIds, 4),
    } as AnalyticsSummaryEntity;
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
   * parameter of any kind. Every parameter is bound only when the caller
   * supplies it; `audience`, `granularity` and `dimension` only with values
   * echoed from the lookup tables (AUDIENCES and this file's). Every report
   * passes `from` / `to` / `retentionCutoff`.
   */
  private _adminQuery(params: {
    from?: string;
    to?: string;
    retentionCutoff?: string;
    audience?: Audience;
    granularity?: string | null;
    dimension?: string;
  }): {
    query: string;
    queryParams: Record<string, unknown>;
  } {
    return {
      query: "",
      queryParams: {
        ...(params.from === undefined ? {} : { from: params.from }),
        ...(params.to === undefined ? {} : { to: params.to }),
        ...(params.retentionCutoff === undefined ? {} : { retentionCutoff: params.retentionCutoff }),
        ...(params.audience === undefined ? {} : { audience: params.audience }),
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
   * Resolves the requested audience against AUDIENCES. Returns the TUPLE'S OWN
   * string, never the caller's, so PEOPLE is only ever indexed by a known key.
   */
  private _audience(requested: Audience): Audience {
    const audience = AUDIENCES.find((a) => a === requested);
    if (!audience) throw new BadRequestException(`audience must be one of ${AUDIENCES.join(", ")}`);
    return audience;
  }

  /**
   * Resolves the requested dimension against the whitelist. Returns the table's
   * own key and expression, never the caller's string.
   */
  private _dimension(requested: Dimension): {
    dimension: Dimension;
    spec: { reads: DimensionReads; key: string };
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
