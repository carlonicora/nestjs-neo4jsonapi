import { Inject, Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { AnalyticsBreakdownDescriptor } from "../entities/analytics-breakdown";
import {
  AnalyticsDailyUniqueTimelineDescriptor,
  AnalyticsDailyUniqueTimelineEntity,
} from "../entities/analytics-daily-unique-timeline";
import { AnalyticsPageViewDescriptor } from "../entities/analytics-page-view";
import { AnalyticsSession, AnalyticsSessionDescriptor } from "../entities/analytics-session";
import { AnalyticsSummaryDescriptor } from "../entities/analytics-summary";
import { AnalyticsTimelineDescriptor } from "../entities/analytics-timeline";
import { ANALYTICS_CONFIG, AnalyticsModuleConfig } from "../interfaces/analytics.config.interface";
import { AnalyticsPageViewRepository } from "../repositories/analytics-page-view.repository";
import { AnalyticsSessionRepository } from "../repositories/analytics-session.repository";
import { AnalyticsAdminRepository, Dimension, Granularity, Section } from "../repositories/analytics.admin.repository";
import { JsonApiListDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";

/**
 * Serialises the platform-wide web analytics reports as JSON:API documents.
 *
 * Extends AbstractService over the AnalyticsSession descriptor and its
 * repository, mirroring TokenUsageAdminService: the inherited CRUD is not
 * reachable from any route on AnalyticsAdminController, but keeps the base
 * class coherent. Summary, timeline and breakdown serialise with the
 * AGGREGATE descriptors' models, because their rows are rollups, not nodes.
 *
 * JSON:API documents are built exclusively by the framework — nothing here
 * hand-assembles a { data: { type, attributes } } object.
 */
@Injectable()
export class AnalyticsAdminService extends AbstractService<
  AnalyticsSession,
  typeof AnalyticsSessionDescriptor.relationships
> {
  protected readonly descriptor = AnalyticsSessionDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    protected readonly analyticsSessionRepository: AnalyticsSessionRepository,
    clsService: ClsService,
    protected readonly analyticsAdminRepository: AnalyticsAdminRepository,
    protected readonly analyticsPageViewRepository: AnalyticsPageViewRepository,
    @Inject(ANALYTICS_CONFIG) private readonly config: Required<AnalyticsModuleConfig>,
  ) {
    super(jsonApiService, analyticsSessionRepository, clsService, AnalyticsSessionDescriptor.model);
  }

  async getSummary(params: { from: string; to: string; section: Section }): Promise<JsonApiListDocument> {
    const rows = await this.analyticsAdminRepository.findSummary({
      from: params.from,
      to: params.to,
      section: params.section,
      retentionCutoff: this.retentionCutoff(),
    });

    return this.jsonApiService.buildList(AnalyticsSummaryDescriptor.model, rows);
  }

  async getTimeline(params: {
    from: string;
    to: string;
    section: Section;
    granularity: Granularity;
  }): Promise<JsonApiListDocument> {
    const rows = await this.analyticsAdminRepository.findTimeline({
      from: params.from,
      to: params.to,
      section: params.section,
      granularity: params.granularity,
      retentionCutoff: this.retentionCutoff(),
    });

    return this.jsonApiService.buildList(AnalyticsTimelineDescriptor.model, rows);
  }

  async getBreakdown(params: {
    from: string;
    to: string;
    section: Section;
    dimension: Dimension;
    limit: number;
  }): Promise<JsonApiListDocument> {
    const rows = await this.analyticsAdminRepository.findBreakdown({
      from: params.from,
      to: params.to,
      section: params.section,
      dimension: params.dimension,
      limit: params.limit,
      retentionCutoff: this.retentionCutoff(),
    });

    return this.jsonApiService.buildList(AnalyticsBreakdownDescriptor.model, rows);
  }

  /**
   * One row per UTC calendar day from `fromDate` to `min(toDate, today UTC)`,
   * ascending, across every section. For each day, in this order:
   * 1. a stored AnalyticsDailyUnique node -> its counts;
   * 2. otherwise raw sessions -> counts from the sessions;
   * 3. otherwise an old AnalyticsDailySummary total row -> null / null
   *    (unknown, drawn as a gap);
   * 4. otherwise -> 0 / 0.
   * No paginator: the range is bounded by the controller's window limit and
   * the chart needs every day in one response (approved exception, 2026-11-04).
   */
  async getDailyUniques(params: { fromDate: string; toDate: string }): Promise<JsonApiListDocument> {
    const sources = await this.analyticsAdminRepository.findDailyUniques({
      fromDate: params.fromDate,
      toDate: params.toDate,
    });
    const byDay = new Map(sources.map((source) => [source.day, source]));

    const today = new Date().toISOString().slice(0, 10);
    const end = params.toDate < today ? params.toDate : today;

    const rows: AnalyticsDailyUniqueTimelineEntity[] = [];
    const cursor = new Date(`${params.fromDate}T00:00:00.000Z`);
    for (let day = params.fromDate; day <= end; day = cursor.toISOString().slice(0, 10)) {
      const source = byDay.get(day);
      const unknownOrZero = source?.hasOldSummary ? { visitors: null, users: null } : { visitors: 0, users: 0 };
      const counts = source?.stored ?? source?.raw ?? unknownOrZero;

      rows.push({ id: day, day, visitors: counts.visitors, users: counts.users } as AnalyticsDailyUniqueTimelineEntity);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return this.jsonApiService.buildList(AnalyticsDailyUniqueTimelineDescriptor.model, rows);
  }

  async getSessions(params: {
    query: any;
    from: string;
    to: string;
    section: Section;
    visitorId?: string;
    userId?: string;
  }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(params.query);

    const rows = await this.analyticsSessionRepository.findForAdmin({
      cursor: paginator.generateCursor(),
      from: params.from,
      to: params.to,
      section: params.section,
      visitorId: params.visitorId,
      userId: params.userId,
    });

    return this.jsonApiService.buildList(AnalyticsSessionDescriptor.model, rows, paginator);
  }

  async getSessionPageViews(params: { sessionId: string }): Promise<JsonApiListDocument> {
    // Throws NotFoundException for an unknown session, so a missing session is
    // a 404 rather than an empty list.
    await this.analyticsSessionRepository.findById({ id: params.sessionId });

    const rows = await this.analyticsPageViewRepository.findBySession({ sessionId: params.sessionId });

    return this.jsonApiService.buildList(AnalyticsPageViewDescriptor.model, rows);
  }

  /**
   * ISO date (YYYY-MM-DD, UTC) `retentionMonths` before today. Raw events older
   * than this are gone (rolled up into daily summaries), so it is the boundary
   * between the two sources the aggregate queries read. Shared with the cron.
   * The day is clamped to the target month's length (31 March − 1 month → 28/29 February).
   */
  retentionCutoff(): string {
    const today = new Date();
    const totalMonths = today.getUTCFullYear() * 12 + today.getUTCMonth() - this.config.retentionMonths;
    const year = Math.floor(totalMonths / 12);
    const month = totalMonths - year * 12;
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(today.getUTCDate(), lastDayOfMonth);

    return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  }
}
