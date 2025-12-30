import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { JsonApiDataInterface } from "../../../core/jsonapi";
import { JsonApiPaginator } from "../../../core/jsonapi";
import { JsonApiService } from "../../../core/jsonapi";
import { StripeSubscriptionApiService } from "./stripe-subscription-api.service";
import { BillingCustomerRepository } from "../../stripe/repositories/billing-customer.repository";
import { StripePriceRepository } from "../../stripe-price/repositories/stripe-price.repository";
import { StripeSubscriptionRepository } from "../repositories/stripe-subscription.repository";
import { StripeSubscriptionModel } from "../entities/stripe-subscription.model";
import { StripeSubscriptionStatus } from "../entities/stripe-subscription.entity";

/**
 * StripeSubscriptionAdminService
 *
 * Manages subscription lifecycle for billing customers, coordinating between Stripe and the local database.
 * Provides comprehensive subscription management including creation, cancellation, pausing, resuming,
 * plan changes, and proration previews.
 *
 * Key Features:
 * - Create subscriptions with optional trials and custom quantities
 * - Cancel subscriptions (immediately or at period end)
 * - Pause and resume subscriptions
 * - Change subscription plans with automatic proration
 * - Preview proration amounts before plan changes
 * - Sync subscription data from Stripe webhooks
 * - Filter subscriptions by status (active, canceled, past_due, etc.)
 *
 * All operations update both Stripe and the local Neo4j database to maintain consistency.
 */
@Injectable()
export class StripeSubscriptionAdminService {
  constructor(
    private readonly subscriptionRepository: StripeSubscriptionRepository,
    private readonly billingCustomerRepository: BillingCustomerRepository,
    private readonly stripePriceRepository: StripePriceRepository,
    private readonly stripeSubscriptionApiService: StripeSubscriptionApiService,
    private readonly jsonApiService: JsonApiService,
  ) {}

  /**
   * List subscriptions for a company
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.query - JSON:API query parameters for pagination
   * @param params.status - Optional filter by subscription status
   * @returns JSON:API formatted list of subscriptions
   * @throws {HttpException} NOT_FOUND if billing customer not found
   *
   * @example
   * ```typescript
   * const subscriptions = await subscriptionService.listSubscriptions({
   *   companyId: 'company_123',
   *   query: { page: { number: 1, size: 10 } },
   *   status: 'active'
   * });
   * ```
   */
  async listSubscriptions(params: {
    companyId: string;
    query: any;
    status?: StripeSubscriptionStatus;
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

    return this.jsonApiService.buildList(StripeSubscriptionModel, subscriptions, paginator);
  }

  /**
   * Get a single subscription by ID
   *
   * @param params - Parameters
   * @param params.id - Subscription ID
   * @param params.companyId - Company identifier
   * @returns JSON:API formatted subscription data
   * @throws {HttpException} NOT_FOUND if subscription not found
   * @throws {HttpException} FORBIDDEN if subscription doesn't belong to company
   */
  async getSubscription(params: { id: string; companyId: string }): Promise<JsonApiDataInterface> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    return this.jsonApiService.buildSingle(StripeSubscriptionModel, subscription);
  }

  /**
   * Create a new subscription
   *
   * @param params - Subscription parameters
   * @param params.companyId - Company identifier
   * @param params.priceId - Price ID to subscribe to
   * @param params.paymentMethodId - Optional payment method ID
   * @param params.trialPeriodDays - Optional trial period in days
   * @param params.quantity - Optional quantity (default: 1)
   * @returns JSON:API formatted subscription data
   * @throws {HttpException} NOT_FOUND if customer or price not found
   *
   * @example
   * ```typescript
   * const subscription = await subscriptionService.createSubscription({
   *   companyId: 'company_123',
   *   priceId: 'price_456',
   *   paymentMethodId: 'pm_789',
   *   trialPeriodDays: 14
   * });
   * ```
   */
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

    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionApiService.createSubscription({
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
      status: stripeSubscription.status as StripeSubscriptionStatus,
      currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000),
      currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000),
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : undefined,
      trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : undefined,
      quantity: params.quantity ?? 1,
    });

    return this.jsonApiService.buildSingle(StripeSubscriptionModel, subscription);
  }

  /**
   * Cancel a subscription
   *
   * @param params - Parameters
   * @param params.id - Subscription ID
   * @param params.companyId - Company identifier
   * @param params.cancelImmediately - If true, cancel immediately; if false, cancel at period end
   * @returns JSON:API formatted updated subscription data
   * @throws {HttpException} NOT_FOUND if subscription not found
   * @throws {HttpException} FORBIDDEN if subscription doesn't belong to company
   *
   * @example
   * ```typescript
   * // Cancel at end of billing period
   * const subscription = await subscriptionService.cancelSubscription({
   *   id: 'sub_123',
   *   companyId: 'company_123',
   *   cancelImmediately: false
   * });
   * ```
   */
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

    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionApiService.cancelSubscription(
      subscription.stripeSubscriptionId,
      !params.cancelImmediately,
    );

    const updatedSubscription = await this.subscriptionRepository.update({
      id: params.id,
      status: stripeSubscription.status as StripeSubscriptionStatus,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      canceledAt: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000) : undefined,
    });

    return this.jsonApiService.buildSingle(StripeSubscriptionModel, updatedSubscription);
  }

  /**
   * Pause a subscription
   *
   * @param params - Parameters
   * @param params.id - Subscription ID
   * @param params.companyId - Company identifier
   * @param params.resumeAt - Optional date to automatically resume
   * @returns JSON:API formatted updated subscription data
   * @throws {HttpException} NOT_FOUND if subscription not found
   * @throws {HttpException} FORBIDDEN if subscription doesn't belong to company
   */
  async pauseSubscription(params: { id: string; companyId: string; resumeAt?: Date }): Promise<JsonApiDataInterface> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionApiService.pauseSubscription(
      subscription.stripeSubscriptionId,
      params.resumeAt,
    );

    const updatedSubscription = await this.subscriptionRepository.update({
      id: params.id,
      status: stripeSubscription.status as StripeSubscriptionStatus,
      pausedAt: new Date(),
    });

    return this.jsonApiService.buildSingle(StripeSubscriptionModel, updatedSubscription);
  }

  /**
   * Resume a paused subscription
   *
   * @param params - Parameters
   * @param params.id - Subscription ID
   * @param params.companyId - Company identifier
   * @returns JSON:API formatted updated subscription data
   * @throws {HttpException} NOT_FOUND if subscription not found
   * @throws {HttpException} FORBIDDEN if subscription doesn't belong to company
   */
  async resumeSubscription(params: { id: string; companyId: string }): Promise<JsonApiDataInterface> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.billingCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionApiService.resumeSubscription(
      subscription.stripeSubscriptionId,
    );

    const updatedSubscription = await this.subscriptionRepository.update({
      id: params.id,
      status: stripeSubscription.status as StripeSubscriptionStatus,
      pausedAt: null,
    });

    return this.jsonApiService.buildSingle(StripeSubscriptionModel, updatedSubscription);
  }

  /**
   * Change subscription plan
   *
   * Updates the subscription to a new price with automatic proration.
   *
   * @param params - Parameters
   * @param params.id - Subscription ID
   * @param params.companyId - Company identifier
   * @param params.newPriceId - New price ID to switch to
   * @returns JSON:API formatted updated subscription data
   * @throws {HttpException} NOT_FOUND if subscription or price not found
   * @throws {HttpException} FORBIDDEN if subscription doesn't belong to company
   *
   * @example
   * ```typescript
   * const subscription = await subscriptionService.changePlan({
   *   id: 'sub_123',
   *   companyId: 'company_123',
   *   newPriceId: 'price_premium'
   * });
   * ```
   */
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

    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionApiService.updateSubscription({
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
      status: stripeSubscription.status as StripeSubscriptionStatus,
      currentPeriodStart: new Date(subscriptionItem.current_period_start * 1000),
      currentPeriodEnd: new Date(subscriptionItem.current_period_end * 1000),
    });

    return this.jsonApiService.buildSingle(StripeSubscriptionModel, updatedSubscription);
  }

  /**
   * Preview proration for plan change
   *
   * Calculates the proration amount for changing to a new price without actually making the change.
   *
   * @param params - Parameters
   * @param params.id - Subscription ID
   * @param params.companyId - Company identifier
   * @param params.newPriceId - New price ID to preview
   * @returns Proration preview with amounts and line items
   * @throws {HttpException} NOT_FOUND if subscription or price not found
   * @throws {HttpException} FORBIDDEN if subscription doesn't belong to company
   *
   * @example
   * ```typescript
   * const preview = await subscriptionService.previewProration({
   *   id: 'sub_123',
   *   companyId: 'company_123',
   *   newPriceId: 'price_premium'
   * });
   * console.log(`Proration amount: ${preview.amountDue}`);
   * ```
   */
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

    const prorationPreview: Stripe.UpcomingInvoice = await this.stripeSubscriptionApiService.previewProration(
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

  /**
   * Sync subscription data from Stripe to local database
   *
   * Fetches the latest subscription data from Stripe and updates the local database record.
   * Used primarily by webhook handlers to keep subscription data in sync.
   *
   * @param params - Parameters
   * @param params.stripeSubscriptionId - Stripe subscription ID to sync
   * @returns Promise that resolves when sync is complete
   *
   * @example
   * ```typescript
   * // Called from webhook handler
   * await subscriptionService.syncSubscriptionFromStripe({
   *   stripeSubscriptionId: 'sub_1234567890'
   * });
   * ```
   */
  async syncSubscriptionFromStripe(params: { stripeSubscriptionId: string }): Promise<void> {
    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionApiService.retrieveSubscription(
      params.stripeSubscriptionId,
    );

    const existingSubscription = await this.subscriptionRepository.findByStripeSubscriptionId({
      stripeSubscriptionId: params.stripeSubscriptionId,
    });

    if (existingSubscription) {
      const subscriptionItem = stripeSubscription.items.data[0];
      await this.subscriptionRepository.updateByStripeSubscriptionId({
        stripeSubscriptionId: params.stripeSubscriptionId,
        status: stripeSubscription.status as StripeSubscriptionStatus,
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
