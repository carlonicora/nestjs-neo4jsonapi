import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "@carlonicora/nestjs-neo4jsonapi";
import { AuthenticatedRequest } from "@carlonicora/nestjs-neo4jsonapi";
import { CreateCustomerDTO } from "../dtos/create-customer.dto";
import { CreateSetupIntentDTO } from "../dtos/create-setup-intent.dto";
import { CancelSubscriptionDTO, CreateSubscriptionDTO, UpdateSubscriptionDTO } from "../dtos/create-subscription.dto";
import { ReportUsageDTO } from "../dtos/report-usage.dto";
import { InvoiceStatus } from "../entities/invoice.entity";
import { SubscriptionStatus } from "../entities/subscription.entity";
import { BillingService } from "../services/billing.service";
import { InvoiceService } from "../services/invoice.service";
import { SubscriptionService } from "../services/subscription.service";
import { UsageService } from "../services/usage.service";

@UseGuards(JwtAuthGuard)
@Controller("billing")
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly subscriptionService: SubscriptionService,
    private readonly invoiceService: InvoiceService,
    private readonly usageService: UsageService,
  ) {}

  // Customer endpoints

  @Get("customer")
  async getCustomer(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const response = await this.billingService.getCustomer({
      companyId: req.user.companyId,
    });

    reply.send(response);
  }

  @Post("customer")
  async createCustomer(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply, @Body() body: CreateCustomerDTO) {
    const response = await this.billingService.createCustomer({
      companyId: req.user.companyId,
      name: body.name,
      email: body.email,
      currency: body.currency,
    });

    reply.status(HttpStatus.CREATED).send(response);
  }

  @Post("setup-intent")
  async createSetupIntent(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: CreateSetupIntentDTO,
  ) {
    const response = await this.billingService.createSetupIntent({
      companyId: req.user.companyId,
      paymentMethodType: body.paymentMethodType,
    });

    reply.send(response);
  }

  @Post("customer/portal-session")
  async createPortalSession(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const response = await this.billingService.createPortalSession({
      companyId: req.user.companyId,
    });

    reply.send(response);
  }

  // Payment methods endpoints

  @Get("payment-methods")
  async listPaymentMethods(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const response = await this.billingService.listPaymentMethods({
      companyId: req.user.companyId,
    });

    reply.send(response);
  }

  @Post("payment-methods/:paymentMethodId/default")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setDefaultPaymentMethod(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("paymentMethodId") paymentMethodId: string,
  ) {
    await this.billingService.setDefaultPaymentMethod({
      companyId: req.user.companyId,
      paymentMethodId,
    });

    reply.send();
  }

  @Delete("payment-methods/:paymentMethodId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePaymentMethod(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("paymentMethodId") paymentMethodId: string,
  ) {
    await this.billingService.removePaymentMethod({
      companyId: req.user.companyId,
      paymentMethodId,
    });

    reply.send();
  }

  // Subscription endpoints

  @Get("subscriptions")
  async listSubscriptions(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("status") status?: SubscriptionStatus,
  ) {
    const response = await this.subscriptionService.listSubscriptions({
      companyId: req.user.companyId,
      query,
      status,
    });

    reply.send(response);
  }

  @Get("subscriptions/:subscriptionId")
  async getSubscription(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
  ) {
    const response = await this.subscriptionService.getSubscription({
      id: subscriptionId,
      companyId: req.user.companyId,
    });

    reply.send(response);
  }

  @Post("subscriptions")
  async createSubscription(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: CreateSubscriptionDTO,
  ) {
    const response = await this.subscriptionService.createSubscription({
      companyId: req.user.companyId,
      priceId: body.priceId,
      paymentMethodId: body.paymentMethodId,
      trialPeriodDays: body.trialPeriodDays,
      quantity: body.quantity,
    });

    reply.status(HttpStatus.CREATED).send(response);
  }

  @Post("subscriptions/:subscriptionId/cancel")
  async cancelSubscription(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: CancelSubscriptionDTO,
  ) {
    const response = await this.subscriptionService.cancelSubscription({
      id: subscriptionId,
      companyId: req.user.companyId,
      cancelImmediately: body.cancelImmediately,
    });

    reply.send(response);
  }

  @Post("subscriptions/:subscriptionId/pause")
  async pauseSubscription(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
  ) {
    const response = await this.subscriptionService.pauseSubscription({
      id: subscriptionId,
      companyId: req.user.companyId,
    });

    reply.send(response);
  }

  @Post("subscriptions/:subscriptionId/resume")
  async resumeSubscription(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
  ) {
    const response = await this.subscriptionService.resumeSubscription({
      id: subscriptionId,
      companyId: req.user.companyId,
    });

    reply.send(response);
  }

  @Post("subscriptions/:subscriptionId/change-plan")
  async changePlan(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: UpdateSubscriptionDTO,
  ) {
    if (!body.priceId) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: "priceId is required" });
      return;
    }

    const response = await this.subscriptionService.changePlan({
      id: subscriptionId,
      companyId: req.user.companyId,
      newPriceId: body.priceId,
    });

    reply.send(response);
  }

  @Get("subscriptions/:subscriptionId/proration-preview")
  async previewProration(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
    @Query("priceId") priceId: string,
  ) {
    if (!priceId) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: "priceId query parameter is required" });
      return;
    }

    const response = await this.subscriptionService.previewProration({
      id: subscriptionId,
      companyId: req.user.companyId,
      newPriceId: priceId,
    });

    reply.send(response);
  }

  // Invoice endpoints

  @Get("invoices")
  async listInvoices(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("status") status?: InvoiceStatus,
  ) {
    const response = await this.invoiceService.listInvoices({
      companyId: req.user.companyId,
      query,
      status,
    });

    reply.send(response);
  }

  @Get("invoices/upcoming")
  async getUpcomingInvoice(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query("subscriptionId") subscriptionId?: string,
  ) {
    const response = await this.invoiceService.getUpcomingInvoice({
      companyId: req.user.companyId,
      subscriptionId,
    });

    reply.send(response);
  }

  @Get("invoices/:invoiceId")
  async getInvoice(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("invoiceId") invoiceId: string,
  ) {
    const response = await this.invoiceService.getInvoice({
      id: invoiceId,
      companyId: req.user.companyId,
    });

    reply.send(response);
  }

  // Usage endpoints

  @Get("meters")
  async listMeters(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const response = await this.usageService.listMeters();
    reply.send(response);
  }

  @Get("meters/:meterId/summaries")
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

  @Post("subscriptions/:subscriptionId/usage")
  async reportUsage(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: ReportUsageDTO,
  ) {
    const response = await this.usageService.reportUsage({
      companyId: req.user.companyId,
      subscriptionId,
      meterId: body.meterId,
      meterEventName: body.meterEventName,
      quantity: body.quantity,
      timestamp: body.timestamp ? new Date(body.timestamp) : undefined,
    });

    reply.status(HttpStatus.CREATED).send(response);
  }

  @Get("subscriptions/:subscriptionId/usage")
  async listUsageRecords(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
    @Query() query: any,
    @Query("startTime") startTime?: string,
    @Query("endTime") endTime?: string,
  ) {
    const response = await this.usageService.listUsageRecords({
      companyId: req.user.companyId,
      subscriptionId,
      query,
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
    });

    reply.send(response);
  }

  @Get("subscriptions/:subscriptionId/usage/summary")
  async getUsageSummary(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
    @Query("startTime") startTime: string,
    @Query("endTime") endTime: string,
  ) {
    if (!startTime || !endTime) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: "startTime and endTime query parameters are required" });
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
