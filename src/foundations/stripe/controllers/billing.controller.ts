import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "../../../common/guards";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CreateSetupIntentDTO } from "../dtos/create-setup-intent.dto";
import { BillingService } from "../services/billing.service";

/**
 * BillingController
 *
 * Handles core billing operations including:
 * - Setup intent creation for payment method collection
 * - Customer portal session creation
 * - Payment method management (list, set default, remove)
 *
 * Usage-related endpoints have been moved to StripeUsageController.
 * Webhook endpoint has been moved to WebhookController in stripe-webhook module.
 */
@Controller("billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  // Setup Intent endpoints

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
}
