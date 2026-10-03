import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { FastifyRequest } from "fastify";
import { OptionalJwtAuthGuard } from "../../../common/guards/jwt.auth.optional.guard";
import { AnalyticsEventPostDTO } from "../dtos/analytics-event.post.dto";
import { analyticsEventMeta } from "../entities/analytics-event.meta";
import { AnalyticsPageViewInput } from "../interfaces/analytics.page-view.input";
import { AnalyticsService } from "../services/analytics.service";

/**
 * Public page-view beacon. Anonymous visitors are accepted; when a valid JWT is
 * present OptionalJwtAuthGuard attaches the user so the session can be linked.
 *
 * The controller only enriches the DTO with the request-derived values
 * (client IP, user agent, user id, receive time) and hands the job to
 * AnalyticsService.track, which queues it and never throws. Raw IP and user
 * agent travel only inside the queued job: the worker hashes / classifies them
 * and nothing raw reaches Neo4j.
 */
@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post(analyticsEventMeta.endpoint)
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 }, ip: { limit: 60, ttl: 60000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async track(
    @Req() request: FastifyRequest & { user?: { userId?: string } },
    @Body() body: AnalyticsEventPostDTO,
  ): Promise<void> {
    const attributes = body.data.attributes;

    const input: AnalyticsPageViewInput = {
      path: attributes.path,
      section: attributes.section,
      referrer: attributes.referrer,
      utmSource: attributes.utmSource,
      utmMedium: attributes.utmMedium,
      utmCampaign: attributes.utmCampaign,
      utmTerm: attributes.utmTerm,
      utmContent: attributes.utmContent,
      visitorId: attributes.visitorId,
      screenWidth: attributes.screenWidth,
      clientIp: this._clientIp(request),
      userAgent: this._header(request.headers["user-agent"]) ?? "",
      userId: request.user?.userId,
      receivedAt: new Date().toISOString(),
    };

    await this.analyticsService.track(input);
  }

  /**
   * First comma-separated hop of X-Forwarded-For, trimmed; request.ip otherwise.
   * Later hops are proxies and would split one visitor across several hashes.
   */
  private _clientIp(request: FastifyRequest): string {
    const forwarded = this._header(request.headers["x-forwarded-for"]);
    const firstHop = forwarded?.split(",")[0]?.trim();
    return firstHop || request.ip;
  }

  private _header(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}
