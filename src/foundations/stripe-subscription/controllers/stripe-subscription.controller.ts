import { Body, Controller, Get, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { JwtAuthGuard, RoleId, Roles } from "../../../common";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import {
  StripeSubscriptionCancelDTO,
  StripeSubscriptionChangePlanDTO,
  StripeSubscriptionPostDTO,
} from "../dtos/stripe-subscription.dto";
import { StripeSubscriptionStatus } from "../entities/stripe-subscription";
import { STRIPE_SUBSCRIPTION_SYNC_SEGMENT, stripeSubscriptionMeta } from "../entities/stripe-subscription.meta";
import { StripeSubscriptionAdminService } from "../services/stripe-subscription-admin.service";
import { ModuleACL } from "../../../common/decorators/module.decorator";
import { CoreModuleId } from "../../../common/constants/core-module.ids";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import { CacheService } from "../../../core/cache/services/cache.service";

// On every route with both, @Roles sits above @CacheInvalidate, which replaces the method:
// metadata set below it would land on the discarded original and never be enforced.
@ModuleACL({ module: CoreModuleId.Billing })
@Controller()
export class StripeSubscriptionController {
  constructor(
    private readonly subscriptionService: StripeSubscriptionAdminService,
    // Read by @CacheInvalidate
    private readonly cacheService: CacheService,
  ) {}

  @Get(stripeSubscriptionMeta.endpoint)
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
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
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.Administrator, RoleId.CompanyAdministrator)
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
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.CompanyAdministrator)
  @CacheInvalidate(stripeSubscriptionMeta)
  async createSubscription(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: StripeSubscriptionPostDTO,
  ) {
    const result = await this.subscriptionService.createSubscription({
      companyId: req.user.companyId,
      priceId: body.data.relationships.stripePrice.data.id,
      paymentMethodId: body.data.attributes?.paymentMethodId,
      trialPeriodDays: body.data.attributes?.trialPeriodDays,
      quantity: body.data.attributes?.quantity,
      promotionCode: body.data.attributes?.promotionCode,
    });

    const response = {
      ...result.data,
      meta: {
        clientSecret: result.clientSecret,
        paymentIntentId: result.paymentIntentId,
        requiresAction: result.requiresAction,
      },
    };

    reply.status(HttpStatus.CREATED).send(response);
  }

  @Post(`${stripeSubscriptionMeta.endpoint}/:subscriptionId/cancel`)
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.CompanyAdministrator)
  @CacheInvalidate(stripeSubscriptionMeta, "subscriptionId")
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

  @Post(`${stripeSubscriptionMeta.endpoint}/:subscriptionId/change-plan`)
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.CompanyAdministrator)
  @CacheInvalidate(stripeSubscriptionMeta, "subscriptionId")
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
      promotionCode: body.data.attributes.promotionCode,
    });

    reply.send(response);
  }

  @Get(`${stripeSubscriptionMeta.endpoint}/:subscriptionId/proration-preview`)
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.CompanyAdministrator)
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

  /**
   * Re-reads the subscription from Stripe and stores it. The wizard calls it right after the
   * browser confirmed the first payment, before the webhooks arrive.
   */
  @Post(`${stripeSubscriptionMeta.endpoint}/:subscriptionId/${STRIPE_SUBSCRIPTION_SYNC_SEGMENT}`)
  @UseGuards(JwtAuthGuard)
  @Roles(RoleId.CompanyAdministrator)
  @CacheInvalidate(stripeSubscriptionMeta, "subscriptionId")
  async syncSubscription(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("subscriptionId") subscriptionId: string,
  ) {
    // Ownership: getSubscription answers 404 / 403 for a subscription of another company
    const subscription = await this.subscriptionService.getSubscription({
      id: subscriptionId,
      companyId: req.user.companyId,
    });

    const stripeSubscriptionId = subscription.data?.attributes?.stripeSubscriptionId;
    if (!stripeSubscriptionId) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: "Subscription has no Stripe ID" });
      return;
    }

    await this.subscriptionService.syncSubscriptionFromStripe({
      stripeSubscriptionId,
    });

    // Return the updated subscription
    const updatedSubscription = await this.subscriptionService.getSubscription({
      id: subscriptionId,
      companyId: req.user.companyId,
    });

    reply.send(updatedSubscription);
  }
}
