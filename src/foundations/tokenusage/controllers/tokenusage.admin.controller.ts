import { BadRequestException, Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { SystemRoles } from "../../../common/constants/system.roles";
import { Roles } from "../../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { tokenUsageMeta } from "../entities/tokenusage.meta";
import { TokenUsageAdminService } from "../services/tokenusage.admin.service";

const GRANULARITIES = ["day", "week", "month"] as const;
const STACK_BY = ["scope", "type", "company"] as const;
const DIMENSIONS = ["company", "user", "operation"] as const;
const SCOPES = ["customer", "platform"] as const;

const DEFAULT_WINDOW_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Platform-wide token-usage reporting. Every route is administrator-only:
 * JwtAuthGuard._validateRoles enforces @Roles and always admits the
 * Administrator role, so a non-administrator receives 401.
 *
 * Mounted at /tokenusages/administration/* — no overlap with the consuming
 * app's own /tokenusages, /tokenusages/summary and /tokenusages/aggregated
 * routes, so importing TokenUsageModule cannot duplicate a Fastify route.
 *
 * Enum-valued query params are validated against a closed allowlist here rather
 * than in a DTO: DTOs are body validation for POST/PUT/PATCH, and GET filters
 * use bare @Query() params. The allowlist matters — the repository interpolates
 * granularity and dimension into Cypher (they select a clause, they are not
 * values), so an unvalidated string would be an injection vector.
 */
@UseGuards(JwtAuthGuard)
@Controller()
export class TokenUsageAdminController {
  constructor(private readonly service: TokenUsageAdminService) {}

  @Get(`${tokenUsageMeta.endpoint}/administration/summary`)
  @Roles(SystemRoles.Administrator)
  async getSummary(
    @Res() reply: FastifyReply,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("companyId") companyId?: string,
  ) {
    const range = this._range(from, to);
    reply.send(await this.service.getSummary({ ...range, companyId }));
  }

  @Get(`${tokenUsageMeta.endpoint}/administration/timeline`)
  @Roles(SystemRoles.Administrator)
  async getTimeline(
    @Res() reply: FastifyReply,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("granularity") granularity?: string,
    @Query("stackBy") stackBy?: string,
    @Query("companyId") companyId?: string,
  ) {
    const range = this._range(from, to);
    reply.send(
      await this.service.getTimeline({
        ...range,
        granularity: this._oneOf(granularity, GRANULARITIES, "day"),
        stackBy: this._oneOf(stackBy, STACK_BY, "scope"),
        companyId,
      }),
    );
  }

  @Get(`${tokenUsageMeta.endpoint}/administration/breakdown`)
  @Roles(SystemRoles.Administrator)
  async getBreakdown(
    @Res() reply: FastifyReply,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("dimension") dimension?: string,
    @Query("scope") scope?: string,
    @Query("companyId") companyId?: string,
    @Query("limit") limit?: string,
  ) {
    const range = this._range(from, to);
    const parsedLimit = limit === undefined ? 10 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)
      throw new BadRequestException("limit must be an integer between 1 and 100");

    reply.send(
      await this.service.getBreakdown({
        ...range,
        dimension: this._oneOf(dimension, DIMENSIONS, "company"),
        scope: this._oneOf(scope, SCOPES, "customer"),
        companyId,
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
