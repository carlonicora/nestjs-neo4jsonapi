import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiPaginator } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeSubscriptionService } from "@carlonicora/nestjs-neo4jsonapi";
import { BillingCustomerRepository } from "../repositories/billing-customer.repository";
import { StripePriceRepository } from "../repositories/stripe-price.repository";
import { SubscriptionRepository } from "../repositories/subscription.repository";
import { SubscriptionModel } from "../entities/subscription.model";
import { SubscriptionStatus } from "../entities/subscription.entity";

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly billingCustomerRepository: BillingCustomerRepository,
    private readonly stripePriceRepository: StripePriceRepository,
    private readonly stripeSubscriptionService: StripeSubscriptionService,
    private readonly jsonApiService: JsonApiService,
  ) {}

  async listSubscriptions(params: {
    companyId: string;
    query: any;
    status?: SubscriptionStatus;
  }): Promise<JsonApiDataInterface> {
    const paginator = new JsonApiPaginator(params.query);

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND);
    }

    const subscriptions = await this.subscriptionRepository.findByBillingCustomerId({
      billingCustomerId: customer.id,
      status: params.status,
    });

    return this.jsonApiService.buildList(SubscriptionModel, subscriptions, paginator);
  }

  async getSubscription(params: { id: string; companyId: string }): Promise<JsonApiDataInterface> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    return this.jsonApiService.buildSingle(SubscriptionModel, subscription);
  }

  async createSubscription(params: {
    companyId: string;
    priceId: string;
    paymentMethodId?: string;
    trialPeriodDays?: number;
    quantity?: number;
  }): Promise<JsonApiDataInterface> {
    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND);
    }

    const price = await this.stripePriceRepository.findById({ id: params.priceId });
    if (!price) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionService.createSubscription({
      stripeCustomerId: customer.stripeCustomerId,
      priceId: price.stripePriceId,
      paymentMethodId: params.paymentMethodId,
      trialPeriodDays: params.trialPeriodDays,
      metadata: {
        companyId: params.companyId,
        priceId: params.priceId,
      },
    });

    const subscriptionItem = stripeSubscription.items.data[0];
    const subscription = await this.subscriptionRepository.create({
      billingCustomerId: customer.id,
      priceId: params.priceId,
      stripeSubscriptionId: stripeSubscription.id,
      stripeSubscriptionItemId: subscriptionItem?.id,
      status: stripeSubscription.status as SubscriptionStatus,
      currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000),
      currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000),
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : undefined,
      trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : undefined,
      quantity: params.quantity ?? 1,
    });

    return this.jsonApiService.buildSingle(SubscriptionModel, subscription);
  }

  async cancelSubscription(params: {
    id: string;
    companyId: string;
    cancelImmediately?: boolean;
  }): Promise<JsonApiDataInterface> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionService.cancelSubscription(
      subscription.stripeSubscriptionId,
      !params.cancelImmediately,
    );

    const updatedSubscription = await this.subscriptionRepository.update({
      id: params.id,
      status: stripeSubscription.status as SubscriptionStatus,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      canceledAt: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000) : undefined,
    });

    return this.jsonApiService.buildSingle(SubscriptionModel, updatedSubscription);
  }

  async pauseSubscription(params: { id: string; companyId: string; resumeAt?: Date }): Promise<JsonApiDataInterface> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionService.pauseSubscription(
      subscription.stripeSubscriptionId,
      params.resumeAt,
    );

    const updatedSubscription = await this.subscriptionRepository.update({
      id: params.id,
      status: stripeSubscription.status as SubscriptionStatus,
      pausedAt: new Date(),
    });

    return this.jsonApiService.buildSingle(SubscriptionModel, updatedSubscription);
  }

  async resumeSubscription(params: { id: string; companyId: string }): Promise<JsonApiDataInterface> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionService.resumeSubscription(
      subscription.stripeSubscriptionId,
    );

    const updatedSubscription = await this.subscriptionRepository.update({
      id: params.id,
      status: stripeSubscription.status as SubscriptionStatus,
      pausedAt: null,
    });

    return this.jsonApiService.buildSingle(SubscriptionModel, updatedSubscription);
  }

  async changePlan(params: { id: string; companyId: string; newPriceId: string }): Promise<JsonApiDataInterface> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const newPrice = await this.stripePriceRepository.findById({ id: params.newPriceId });
    if (!newPrice) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionService.updateSubscription({
      subscriptionId: subscription.stripeSubscriptionId,
      priceId: newPrice.stripePriceId,
      prorationBehavior: "create_prorations",
    });

    await this.subscriptionRepository.updatePrice({
      id: params.id,
      newPriceId: params.newPriceId,
    });

    const subscriptionItem = stripeSubscription.items.data[0];
    const updatedSubscription = await this.subscriptionRepository.update({
      id: params.id,
      status: stripeSubscription.status as SubscriptionStatus,
      currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000),
      currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000),
    });

    return this.jsonApiService.buildSingle(SubscriptionModel, updatedSubscription);
  }

  async previewProration(params: { id: string; companyId: string; newPriceId: string }): Promise<any> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const newPrice = await this.stripePriceRepository.findById({ id: params.newPriceId });
    if (!newPrice) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    const prorationPreview: Stripe.UpcomingInvoice = await this.stripeSubscriptionService.previewProration(
      subscription.stripeSubscriptionId,
      newPrice.stripePriceId,
    );

    return {
      subtotal: prorationPreview.subtotal,
      total: prorationPreview.total,
      amountDue: prorationPreview.amount_due,
      currency: prorationPreview.currency,
      lines: prorationPreview.lines.data.map((line: Stripe.InvoiceLineItem) => ({
        description: line.description,
        amount: line.amount,
        proration: (line as any).proration,
      })),
    };
  }

  async syncSubscriptionFromStripe(params: { stripeSubscriptionId: string }): Promise<void> {
    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionService.retrieveSubscription(
      params.stripeSubscriptionId,
    );

    const existingSubscription = await this.subscriptionRepository.findByStripeSubscriptionId({
      stripeSubscriptionId: params.stripeSubscriptionId,
    });

    if (existingSubscription) {
      const subscriptionItem = stripeSubscription.items.data[0];
      await this.subscriptionRepository.updateByStripeSubscriptionId({
        stripeSubscriptionId: params.stripeSubscriptionId,
        status: stripeSubscription.status as SubscriptionStatus,
        currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000),
        currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        canceledAt: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000) : null,
        trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : undefined,
        trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : undefined,
      });
    }
  }
}
