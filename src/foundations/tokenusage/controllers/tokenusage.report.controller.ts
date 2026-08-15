import { BadRequestException, Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { tokenUsageMeta } from "../entities/tokenusage.meta";
import { TokenUsageReportService } from "../services/tokenusage.report.service";

const GRANULARITIES = ["day", "week", "month"] as const;
const DIMENSIONS = ["operation", "target"] as const;
const METRICS = ["credits", "tokens"] as const;

const DEFAULT_WINDOW_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Self-service token-usage reporting: the caller's own company only.
 *
 * NO @Roles decorator anywhere — any authenticated user may read their own
 * company's usage. Scoping is the repository's job (buildDefaultMatch injects
 * the CLS company), and no route here accepts a companyId, so there is nothing
 * for a caller to point at somebody else's data.
 *
 * `metric` is allowlisted to credits and tokens: COST IS DELIBERATELY ABSENT.
 * Customers are billed in credits, and exposing the platform's monetary cost
 * would leak margin — enforcing that only in the UI would leave it one query
 * string away, so the boundary refuses it.
 *
 * Mounted at /tokenusages/reports/* — no overlap with /tokenusages,
 * /tokenusages/summary, /tokenusages/aggregated (a consuming app's own routes)
 * or /tokenusages/administration/*, so importing TokenUsageModule cannot
 * duplicate a Fastify route.
 *
 * Enum query params are validated against closed allowlists here rather than in
 * a DTO: DTOs are body validation for POST/PUT/PATCH, and GET filters use bare
 * @Query params. The allowlist matters — granularity and dimension select a
 * Cypher clause, they are not bound values.
 */
@UseGuards(JwtAuthGuard)
@Controller()
export class TokenUsageReportController {
  constructor(private readonly service: TokenUsageReportService) {}

  @Get(`${tokenUsageMeta.endpoint}/reports/summary`)
  async getSummary(@Res() reply: FastifyReply, @Query("from") from?: string, @Query("to") to?: string) {
    reply.send(await this.service.getSummary(this._range(from, to)));
  }

  @Get(`${tokenUsageMeta.endpoint}/reports/timeline`)
  async getTimeline(
    @Res() reply: FastifyReply,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("granularity") granularity?: string,
  ) {
    reply.send(
      await this.service.getTimeline({
        ...this._range(from, to),
        granularity: this._oneOf(granularity, GRANULARITIES, "day"),
        // Pinned, not accepted: scope and company stacking are meaningless
        // inside a single tenant, so "type" is the only series this surface has.
        stackBy: "type",
      }),
    );
  }

  @Get(`${tokenUsageMeta.endpoint}/reports/breakdown`)
  async getBreakdown(
    @Res() reply: FastifyReply,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("dimension") dimension?: string,
    @Query("targetLabel") targetLabel?: string,
    @Query("metric") metric?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit === undefined ? 10 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)
      throw new BadRequestException("limit must be an integer between 1 and 100");

    reply.send(
      await this.service.getBreakdown({
        ...this._range(from, to),
        dimension: this._oneOf(dimension, DIMENSIONS, "operation"),
        targetLabel,
        metric: this._oneOf(metric, METRICS, "credits"),
        limit: parsedLimit,
      }),
    );
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

    return { from: fromDate.toISOString(), to: toDate.toISOString() };
  }
}
