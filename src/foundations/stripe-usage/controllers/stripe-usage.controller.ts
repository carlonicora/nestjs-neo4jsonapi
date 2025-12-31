import { Body, Controller, Get, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "../../../common/guards";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { stripeUsageRecordMeta } from "../entities/stripe-usage-record.meta";
import { StripeUsageRecordPostDTO } from "../dtos/stripe-usage.dto";
import { StripeUsageAdminService } from "../services/stripe-usage-admin.service";

/**
 * StripeUsageController
 *
 * JSON:API compliant controller for usage-based billing.
 * Handles meter queries and usage record management.
 *
 * Routes:
 * - GET  /stripe-usage-records/meters           - List all billing meters
 * - GET  /stripe-usage-records/meters/:id/summaries - Get meter event summaries
 * - POST /stripe-usage-records                  - Report usage (with subscription relationship)
 * - GET  /stripe-usage-records                  - List usage records (filter by subscription)
 * - GET  /stripe-usage-records/summary          - Get usage summary
 */
@Controller(stripeUsageRecordMeta.endpoint)
export class StripeUsageController {
  constructor(private readonly usageService: StripeUsageAdminService) {}

  /**
   * List all available billing meters from Stripe
   */
  @Get("meters")
  async listMeters(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const response = await this.usageService.listMeters();
    reply.send(response);
  }

  /**
   * Get meter event summaries for a specific meter
   */
  @Get("meters/:meterId/summaries")
  @UseGuards(JwtAuthGuard)
  async getMeterSummaries(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("meterId") meterId: string,
    @Query("startTime") startTime: string,
    @Query("endTime") endTime: string,
  ) {
    if (!startTime || !endTime) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: "startTime and endTime query parameters are required" });
      return;
    }

    const response = await this.usageService.getMeterEventSummaries({
      companyId: req.user.companyId,
      meterId,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
    });

    reply.send(response);
  }

  /**
   * Report usage for a subscription (JSON:API compliant)
   *
   * The subscription is specified via the relationships.subscription field in the request body.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async reportUsage(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: StripeUsageRecordPostDTO,
  ) {
    const subscriptionId = body.data.relationships.subscription.data.id;

    const response = await this.usageService.reportUsage({
      companyId: req.user.companyId,
      subscriptionId,
      meterId: body.data.attributes.meterId,
      meterEventName: body.data.attributes.meterEventName,
      quantity: body.data.attributes.quantity,
      timestamp: body.data.attributes.timestamp ? new Date(body.data.attributes.timestamp) : undefined,
    });

    reply.status(HttpStatus.CREATED).send(response);
  }

  /**
   * List usage records
   *
   * Filters by subscription via query parameter: ?filter[subscriptionId]=<uuid>
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async listUsageRecords(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("filter[subscriptionId]") subscriptionId?: string,
    @Query("startTime") startTime?: string,
    @Query("endTime") endTime?: string,
  ) {
    if (!subscriptionId) {
      reply.status(HttpStatus.BAD_REQUEST).send({
        errors: [
          { status: "400", title: "Missing filter", detail: "filter[subscriptionId] query parameter is required" },
        ],
      });
      return;
    }

    const response = await this.usageService.listUsageRecords({
      companyId: req.user.companyId,
      subscriptionId,
      query,
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
    });

    reply.send(response);
  }

  /**
   * Get usage summary for a subscription
   *
   * Filters by subscription via query parameter: ?filter[subscriptionId]=<uuid>
   */
  @Get("summary")
  @UseGuards(JwtAuthGuard)
  async getUsageSummary(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query("filter[subscriptionId]") subscriptionId: string,
    @Query("startTime") startTime: string,
    @Query("endTime") endTime: string,
  ) {
    if (!subscriptionId) {
      reply.status(HttpStatus.BAD_REQUEST).send({
        errors: [
          { status: "400", title: "Missing filter", detail: "filter[subscriptionId] query parameter is required" },
        ],
      });
      return;
    }

    if (!startTime || !endTime) {
      reply.status(HttpStatus.BAD_REQUEST).send({
        errors: [
          { status: "400", title: "Missing parameters", detail: "startTime and endTime query parameters are required" },
        ],
      });
      return;
    }

    const response = await this.usageService.getUsageSummary({
      companyId: req.user.companyId,
      subscriptionId,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
    });

    reply.send(response);
  }
}
