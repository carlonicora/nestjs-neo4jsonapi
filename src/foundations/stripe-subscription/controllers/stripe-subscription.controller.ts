import { Body, Controller, Get, HttpStatus, Param, Post, Query, Req, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import {
  StripeSubscriptionPostDTO,
  StripeSubscriptionCancelDTO,
  StripeSubscriptionChangePlanDTO,
} from "../dtos/stripe-subscription.dto";
import { StripeSubscriptionStatus } from "../entities/stripe-subscription.entity";
import { stripeSubscriptionMeta } from "../entities/stripe-subscription.meta";
import { StripeSubscriptionAdminService } from "../services/stripe-subscription-admin.service";

@Controller()
export class StripeSubscriptionController {
  constructor(private readonly subscriptionService: StripeSubscriptionAdminService) {}

  @Get(stripeSubscriptionMeta.endpoint)
  async listSubscriptions(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("status") status?: StripeSubscriptionStatus,
  ) {
    const response = await this.subscriptionService.listSubscriptions({
      companyId: req.user.companyId,
      query,
      status,
    });

    reply.send(response);
  }

  @Get(`${stripeSubscriptionMeta.endpoint}/:subscriptionId`)
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

  @Post(`${stripeSubscriptionMeta.endpoint}`)
  async createSubscription(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: StripeSubscriptionPostDTO,
  ) {
    const response = await this.subscriptionService.createSubscription({
      companyId: req.user.companyId,
      priceId: body.data.attributes.priceId,
      paymentMethodId: body.data.attributes.paymentMethodId,
      trialPeriodDays: body.data.attributes.trialPeriodDays,
      quantity: body.data.attributes.quantity,
    });

    reply.status(HttpStatus.CREATED).send(response);
  }

  @Post(`${stripeSubscriptionMeta.endpoint}/:subscriptionId/cancel`)
  async cancelSubscription(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: StripeSubscriptionCancelDTO,
  ) {
    const response = await this.subscriptionService.cancelSubscription({
      id: subscriptionId,
      companyId: req.user.companyId,
      cancelImmediately: body.data.attributes?.cancelImmediately,
    });

    reply.send(response);
  }

  @Post(`${stripeSubscriptionMeta.endpoint}/:subscriptionId/pause`)
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

  @Post(`${stripeSubscriptionMeta.endpoint}/:subscriptionId/resume`)
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

  @Post(`${stripeSubscriptionMeta.endpoint}/:subscriptionId/change-plan`)
  async changePlan(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: StripeSubscriptionChangePlanDTO,
  ) {
    if (!body.data.attributes.priceId) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: "priceId is required" });
      return;
    }

    const response = await this.subscriptionService.changePlan({
      id: subscriptionId,
      companyId: req.user.companyId,
      newPriceId: body.data.attributes.priceId,
    });

    reply.send(response);
  }

  @Get(`${stripeSubscriptionMeta.endpoint}/:subscriptionId/proration-preview`)
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
}
