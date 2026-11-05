import { BadRequestException, Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { SystemRoles } from "../../../common/constants/system.roles";
import { Roles } from "../../../common/decorators/roles.decorator";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { Audit } from "../../../common/decorators/audit.decorator";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuditService } from "../../audit/services/audit.service";
import { analyticsBreakdownMeta } from "../entities/analytics-breakdown.meta";
import { analyticsDailyUniqueTimelineMeta } from "../entities/analytics-daily-unique-timeline.meta";
import { analyticsPageViewMeta } from "../entities/analytics-page-view.meta";
import { analyticsSessionMeta } from "../entities/analytics-session.meta";
import { analyticsSummaryMeta } from "../entities/analytics-summary.meta";
import { analyticsTimelineMeta } from "../entities/analytics-timeline.meta";
import { DIMENSIONS, GRANULARITIES, SECTIONS } from "../repositories/analytics.admin.repository";
import { AnalyticsAdminService } from "../services/analytics.admin.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 400;
const DEFAULT_BREAKDOWN_LIMIT = 20;
const MAX_BREAKDOWN_LIMIT = 100;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Platform-wide web analytics reporting. Every route is administrator-only:
 * JwtAuthGuard._validateRoles enforces @Roles and always admits the
 * Administrator role, so a non-administrator receives 401.
 *
 * Mounted at /analytics/administration/* — the only other analytics route is
 * the public POST /wayfinding beacon, so there is no Fastify overlap.
 *
 * Enum-valued query params are validated against a closed allowlist here rather
 * than in a DTO: DTOs are body validation for POST/PUT/PATCH, and GET filters
 * use bare @Query() params. The allowlist matters — the repository interpolates
 * granularity and dimension into Cypher (they select a clause, they are not
 * values), so an unvalidated string would be an injection vector.
 */
@UseGuards(JwtAuthGuard)
@ModuleACL({ module: CoreModuleId.Analytics })
@Controller()
export class AnalyticsAdminController {
  private readonly crud = createCrudHandlers(() => this.service);

  constructor(
    private readonly service: AnalyticsAdminService,
    private readonly auditService: AuditService,
  ) {}

  @Get(analyticsSummaryMeta.endpoint)
  @Roles(SystemRoles.Administrator)
  async getSummary(
    @Res() reply: FastifyReply,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("section") section?: string,
  ) {
    const range = this._range(from, to);
    reply.send(
      await this.service.getSummary({
        ...range,
        section: this._oneOf(section, SECTIONS, "all"),
      }),
    );
  }

  @Get(analyticsTimelineMeta.endpoint)
  @Roles(SystemRoles.Administrator)
  async getTimeline(
    @Res() reply: FastifyReply,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("section") section?: string,
    @Query("granularity") granularity?: string,
  ) {
    const range = this._range(from, to);
    reply.send(
      await this.service.getTimeline({
        ...range,
        section: this._oneOf(section, SECTIONS, "all"),
        granularity: this._oneOf(granularity, GRANULARITIES, "day"),
      }),
    );
  }

  @Get(analyticsBreakdownMeta.endpoint)
  @Roles(SystemRoles.Administrator)
  async getBreakdown(
    @Res() reply: FastifyReply,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("section") section?: string,
    @Query("dimension") dimension?: string,
    @Query("limit") limit?: string,
  ) {
    const range = this._range(from, to);
    const parsedLimit = limit === undefined ? DEFAULT_BREAKDOWN_LIMIT : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_BREAKDOWN_LIMIT)
      throw new BadRequestException(`limit must be an integer between 1 and ${MAX_BREAKDOWN_LIMIT}`);

    reply.send(
      await this.service.getBreakdown({
        ...range,
        section: this._oneOf(section, SECTIONS, "all"),
        dimension: this._oneOf(dimension, DIMENSIONS, "source"),
        limit: parsedLimit,
      }),
    );
  }

  /**
   * Unique visitors and unique users per UTC day, always daily and across every
   * section, so it takes no `section` or `granularity`. `fromDate` / `toDate`
   * are calendar days (YYYY-MM-DD), not instants.
   */
  @Get(analyticsDailyUniqueTimelineMeta.endpoint)
  @Roles(SystemRoles.Administrator)
  async getDailyUniques(
    @Res() reply: FastifyReply,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
  ) {
    reply.send(await this.service.getDailyUniques(this._dateRange(fromDate, toDate)));
  }

  @Get(analyticsSessionMeta.endpoint)
  @Roles(SystemRoles.Administrator)
  async getSessions(
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("section") section?: string,
    @Query("visitorId") visitorId?: string,
    @Query("userId") userId?: string,
  ) {
    const range = this._range(from, to);
    reply.send(
      await this.service.getSessions({
        query,
        ...range,
        section: this._oneOf(section, SECTIONS, "all"),
        visitorId,
        userId,
      }),
    );
  }

  // The inherited AbstractService.findById builds the single JSON:API document,
  // with the optional `user` relationship included from the descriptor.
  @Get(`${analyticsSessionMeta.endpoint}/:sessionId`)
  @Roles(SystemRoles.Administrator)
  @Audit(analyticsSessionMeta, "sessionId")
  async getSession(
    // The request carries the route param @Audit reads.
    @Req() _req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("sessionId") sessionId: string,
  ) {
    return this.crud.findById(reply, sessionId);
  }

  @Get(`${analyticsSessionMeta.endpoint}/:sessionId/${analyticsPageViewMeta.endpoint}`)
  @Roles(SystemRoles.Administrator)
  async getSessionPageViews(@Res() reply: FastifyReply, @Param("sessionId") sessionId: string) {
    reply.send(await this.service.getSessionPageViews({ sessionId }));
  }

  private _oneOf<T extends readonly string[]>(value: string | undefined, allowed: T, fallback: T[number]): T[number] {
    if (value === undefined) return fallback;
    if (!allowed.includes(value))
      throw new BadRequestException(`Expected one of ${allowed.join(", ")}, received "${value}"`);
    return value as T[number];
  }

  private _range(from?: string, to?: string): { from: string; to: string } {
    const toDate = to ? new Date(to) : new Date();
    if (Number.isNaN(toDate.getTime())) throw new BadRequestException("`to` is not a valid date");

    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - DEFAULT_WINDOW_DAYS * ONE_DAY_MS);
    if (Number.isNaN(fromDate.getTime())) throw new BadRequestException("`from` is not a valid date");

    if (fromDate > toDate) throw new BadRequestException("`from` must not be later than `to`");

    if (toDate.getTime() - fromDate.getTime() > MAX_WINDOW_DAYS * ONE_DAY_MS)
      throw new BadRequestException(`The range must not exceed ${MAX_WINDOW_DAYS} days`);

    return { from: fromDate.toISOString(), to: toDate.toISOString() };
  }

  /**
   * Validates a calendar-day range. Each date must be `YYYY-MM-DD` and a real
   * day (round-tripped through Date.UTC, so 2026-02-30 is refused). When both
   * are absent the range is the last DEFAULT_WINDOW_DAYS days ending today UTC.
   */
  private _dateRange(fromDate?: string, toDate?: string): { fromDate: string; toDate: string } {
    const to = toDate ?? new Date().toISOString().slice(0, 10);
    const toMs = this._calendarDay(to, "toDate");

    const from = fromDate ?? new Date(toMs - DEFAULT_WINDOW_DAYS * ONE_DAY_MS).toISOString().slice(0, 10);
    const fromMs = this._calendarDay(from, "fromDate");

    if (fromMs > toMs) throw new BadRequestException("`fromDate` must not be later than `toDate`");

    if (toMs - fromMs > MAX_WINDOW_DAYS * ONE_DAY_MS)
      throw new BadRequestException(`The range must not exceed ${MAX_WINDOW_DAYS} days`);

    return { fromDate: from, toDate: to };
  }

  /** UTC midnight of a `YYYY-MM-DD` calendar day, or a 400 when it is not one. */
  private _calendarDay(value: string, name: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new BadRequestException(`\`${name}\` must be a date in YYYY-MM-DD format`);

    const [, year, month, day] = match;
    const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
    if (new Date(ms).toISOString().slice(0, 10) !== value)
      throw new BadRequestException(`\`${name}\` is not a valid calendar date`);

    return ms;
  }
}
