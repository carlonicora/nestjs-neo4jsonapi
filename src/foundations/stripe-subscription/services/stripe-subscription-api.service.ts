import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "../../stripe/services/stripe.service";
import { HandleStripeErrors } from "../../stripe/errors/stripe.errors";

/**
 * Stripe Subscription API Service
 *
 * Manages Stripe subscription operations including creation, updates, cancellations, pausing/resuming,
 * and proration previews. Handles subscription lifecycle and billing changes.
 *
 * @example
 * ```typescript
 * const subscription = await stripeSubscriptionApiService.createSubscription({
 *   stripeCustomerId: 'cus_abc123',
 *   priceId: 'price_xyz789',
 *   paymentMethodId: 'pm_def456',
 * });
 * ```
 */
@Injectable()
export class StripeSubscriptionApiService {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Create a new subscription for a customer
   *
   * @param params - Subscription creation parameters
   * @param params.stripeCustomerId - The Stripe customer ID
   * @param params.priceId - The Stripe price ID to subscribe to
   * @param params.paymentMethodId - Default payment method ID (optional)
   * @param params.trialPeriodDays - Number of trial days (optional)
   * @param params.metadata - Additional metadata (optional)
   * @returns Promise resolving to the created subscription with expanded invoice and payment intent
   * @throws {StripeError} If subscription creation fails
   *
   * @example
   * ```typescript
   * const subscription = await service.createSubscription({
   *   stripeCustomerId: 'cus_abc123',
   *   priceId: 'price_xyz789',
   *   trialPeriodDays: 14,
   * });
   * ```
   */
  @HandleStripeErrors()
  async createSubscription(params: {
    stripeCustomerId: string;
    priceId: string;
    paymentMethodId?: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();

    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: params.stripeCustomerId,
      items: [{ price: params.priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
      metadata: params.metadata,
    };

    if (params.paymentMethodId) {
      subscriptionParams.default_payment_method = params.paymentMethodId;
    }
    if (params.trialPeriodDays) {
      subscriptionParams.trial_period_days = params.trialPeriodDays;
    }

    return stripe.subscriptions.create(subscriptionParams);
  }

  /**
   * Retrieve a subscription by ID
   *
   * @param subscriptionId - The Stripe subscription ID
   * @returns Promise resolving to the subscription with expanded invoice and payment method
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const subscription = await service.retrieveSubscription('sub_abc123');
   * ```
   */
  @HandleStripeErrors()
  async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();
    return stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["latest_invoice", "default_payment_method"],
    });
  }

  /**
   * Update an existing subscription
   *
   * @param params - Subscription update parameters
   * @param params.subscriptionId - The subscription ID to update
   * @param params.priceId - New price ID to change plan (optional)
   * @param params.prorationBehavior - How to handle proration (optional)
   * @param params.metadata - Updated metadata (optional)
   * @returns Promise resolving to the updated subscription
   * @throws {StripeError} If update fails
   *
   * @example
   * ```typescript
   * const subscription = await service.updateSubscription({
   *   subscriptionId: 'sub_abc123',
   *   priceId: 'price_new789',
   *   prorationBehavior: 'create_prorations',
   * });
   * ```
   */
  @HandleStripeErrors()
  async updateSubscription(params: {
    subscriptionId: string;
    priceId?: string;
    prorationBehavior?: Stripe.SubscriptionUpdateParams.ProrationBehavior;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();
    const updateParams: Stripe.SubscriptionUpdateParams = {};

    if (params.priceId) {
      const currentSub = await stripe.subscriptions.retrieve(params.subscriptionId);
      const itemId = currentSub.items.data[0]?.id;
      if (itemId) {
        updateParams.items = [{ id: itemId, price: params.priceId }];
      }
    }

    if (params.prorationBehavior) {
      updateParams.proration_behavior = params.prorationBehavior;
    }

    if (params.metadata) {
      updateParams.metadata = params.metadata;
    }

    return stripe.subscriptions.update(params.subscriptionId, updateParams);
  }

  /**
   * Cancel a subscription
   *
   * @param subscriptionId - The subscription ID to cancel
   * @param cancelAtPeriodEnd - If true, cancels at period end; if false, cancels immediately (default: true)
   * @returns Promise resolving to the updated/canceled subscription
   * @throws {StripeError} If cancellation fails
   *
   * @example
   * ```typescript
   * // Cancel at end of billing period
   * const subscription = await service.cancelSubscription('sub_abc123', true);
   *
   * // Cancel immediately
   * const subscription = await service.cancelSubscription('sub_abc123', false);
   * ```
   */
  @HandleStripeErrors()
  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd: boolean = true): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();

    if (cancelAtPeriodEnd) {
      return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    }
    return stripe.subscriptions.cancel(subscriptionId);
  }

  /**
   * Pause a subscription
   *
   * @param subscriptionId - The subscription ID to pause
   * @param resumeAt - Optional date to automatically resume the subscription
   * @returns Promise resolving to the paused subscription
   * @throws {StripeError} If pausing fails
   *
   * @example
   * ```typescript
   * const resumeDate = new Date('2025-02-01');
   * const subscription = await service.pauseSubscription('sub_abc123', resumeDate);
   * ```
   */
  @HandleStripeErrors()
  async pauseSubscription(subscriptionId: string, resumeAt?: Date): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();

    const pauseCollection: Stripe.SubscriptionUpdateParams.PauseCollection = {
      behavior: "mark_uncollectible",
    };
    if (resumeAt) {
      pauseCollection.resumes_at = Math.floor(resumeAt.getTime() / 1000);
    }

    return stripe.subscriptions.update(subscriptionId, { pause_collection: pauseCollection });
  }

  /**
   * Resume a paused subscription
   *
   * @param subscriptionId - The subscription ID to resume
   * @returns Promise resolving to the resumed subscription
   * @throws {StripeError} If resuming fails
   *
   * @example
   * ```typescript
   * const subscription = await service.resumeSubscription('sub_abc123');
   * ```
   */
  @HandleStripeErrors()
  async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();
    return stripe.subscriptions.update(subscriptionId, { pause_collection: "" as any });
  }

  /**
   * Preview proration amounts for a subscription plan change
   *
   * @param subscriptionId - The subscription ID
   * @param newPriceId - The new price ID to preview
   * @returns Promise resolving to the upcoming invoice preview with proration details
   * @throws {StripeError} If preview fails
   *
   * @example
   * ```typescript
   * const preview = await service.previewProration('sub_abc123', 'price_new789');
   * console.log('Proration amount:', preview.amount_due);
   * ```
   */
  @HandleStripeErrors()
  async previewProration(subscriptionId: string, newPriceId: string): Promise<Stripe.UpcomingInvoice> {
    const stripe = this.stripeService.getClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = subscription.items.data[0]?.id;

    return stripe.invoices.createPreview({
      customer: subscription.customer as string,
      subscription: subscriptionId,
      subscription_details: {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: "create_prorations",
      },
    });
  }

  /**
   * List all subscriptions for a customer
   *
   * @param stripeCustomerId - The Stripe customer ID
   * @param status - Filter by subscription status (optional)
   * @returns Promise resolving to array of subscriptions
   * @throws {StripeError} If listing fails
   *
   * @example
   * ```typescript
   * // List all subscriptions
   * const subscriptions = await service.listSubscriptions('cus_abc123');
   *
   * // List only active subscriptions
   * const activeSubscriptions = await service.listSubscriptions('cus_abc123', 'active');
   * ```
   */
  @HandleStripeErrors()
  async listSubscriptions(
    stripeCustomerId: string,
    status?: Stripe.SubscriptionListParams.Status,
  ): Promise<Stripe.Subscription[]> {
    const stripe = this.stripeService.getClient();
    const params: Stripe.SubscriptionListParams = {
      customer: stripeCustomerId,
      limit: 100,
    };
    if (status) {
      params.status = status;
    }
    const subscriptions = await stripe.subscriptions.list(params);
    return subscriptions.data;
  }
}
