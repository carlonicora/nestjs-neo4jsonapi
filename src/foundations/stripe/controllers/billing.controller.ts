import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { Roles } from "../../../common/decorators";
import { AdminJwtAuthGuard, JwtAuthGuard } from "../../../common/guards";
import { RoleId } from "../../../common/constants/system.roles";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CreateCustomerDTO } from "../dtos/create-customer.dto";
import { CreateSetupIntentDTO } from "../dtos/create-setup-intent.dto";
import { ReportUsageDTO } from "../dtos/report-usage.dto";
import { BillingService } from "../services/billing.service";
import { UsageService } from "../services/usage.service";

@Controller("billing")
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly usageService: UsageService,
  ) {}

  // Customer endpoints

  @Get("customers")
  @UseGuards(JwtAuthGuard)
  async getCustomer(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const response = await this.billingService.getCustomer({
      companyId: req.user.companyId,
    });

    reply.send(response);
  }

  @Post("customers")
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
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

  @Post("customers/portal-session")
  @UseGuards(JwtAuthGuard)
  async createPortalSession(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const response = await this.billingService.createPortalSession({
      companyId: req.user.companyId,
    });

    reply.send(response);
  }

  // Payment methods endpoints

  @Get("payment-methods")
  @UseGuards(JwtAuthGuard)
  async listPaymentMethods(@Req() req: AuthenticatedRequest, @Res() reply: FastifyReply) {
    const response = await this.billingService.listPaymentMethods({
      companyId: req.user.companyId,
    });

    reply.send(response);
  }

  @Post("payment-methods/:paymentMethodId/default")
  @UseGuards(JwtAuthGuard)
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
