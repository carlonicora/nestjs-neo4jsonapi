import { BadRequestException, Controller, Get, Param, Query, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { SystemRoles } from "../../../common/constants/system.roles";
import { Roles } from "../../../common/decorators/roles.decorator";
import { createCrudHandlers } from "../../../common/handlers/crud.handlers";
import { Audit } from "../../../common/decorators/audit.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AuditService } from "../../audit/services/audit.service";
import { analyticsBreakdownMeta } from "../entities/analytics-breakdown.meta";
import { analyticsPageViewMeta } from "../entities/analytics-page-view.meta";
import { analyticsSessionMeta } from "../entities/analytics-session.meta";
import { analyticsSummaryMeta } from "../entities/analytics-summary.meta";
import { analyticsTimelineMeta } from "../entities/analytics-timeline.meta";
import { DIMENSIONS, GRANULARITIES, SECTIONS } from "../repositories/analytics.admin.repository";
import { AnalyticsAdminService } from "../services/analytics.admin.service";

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
 * the public POST /analytics/events beacon, so there is no Fastify overlap.
 *
 * Enum-valued query params are validated against a closed allowlist here rather
 * than in a DTO: DTOs are body validation for POST/PUT/PATCH, and GET filters
 * use bare @Query() params. The allowlist matters — the repository interpolates
 * granularity and dimension into Cypher (they select a clause, they are not
 * values), so an unvalidated string would be an injection vector.
 */
@UseGuards(JwtAuthGuard)
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
  async getSession(@Res() reply: FastifyReply, @Param("sessionId") sessionId: string) {
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
}
