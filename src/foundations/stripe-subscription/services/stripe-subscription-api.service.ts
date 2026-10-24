import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { HandleStripeErrors } from "../../stripe/errors/stripe.errors";
import { StripeService } from "../../stripe/services/stripe.service";
import { STRIPE_SUBSCRIPTION_DISCOUNT_EXPAND } from "../entities/stripe-subscription.discount";
import { STRIPE_UNPAID_ATTEMPT_CANCELLATION_COMMENT } from "../entities/stripe-subscription.meta";
import { SUBSCRIPTION_PAYMENT_EXPAND } from "./subscription-payment-confirmation";

/**
 * Stripe Subscription API Service
 *
 * Manages Stripe subscription operations including creation, updates, cancellations
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
   * @param params.trialPeriodDays - Number of trial days (optional, ignored if trialEnd is set)
   * @param params.trialEnd - Unix timestamp for trial end (optional, takes precedence over trialPeriodDays)
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
    trialEnd?: number; // Unix timestamp - takes precedence over trialPeriodDays
    metadata?: Record<string, string>;
    promotionCode?: string;
  }): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();

    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: params.stripeCustomerId,
      items: [{ price: params.priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: [...SUBSCRIPTION_PAYMENT_EXPAND, "pending_setup_intent", STRIPE_SUBSCRIPTION_DISCOUNT_EXPAND],
      metadata: params.metadata,
    };

    if (params.paymentMethodId) {
      subscriptionParams.default_payment_method = params.paymentMethodId;
    }
    // trialEnd takes precedence over trialPeriodDays (useful for testing with short trials)
    if (params.trialEnd) {
      subscriptionParams.trial_end = params.trialEnd;
    } else if (params.trialPeriodDays) {
      subscriptionParams.trial_period_days = params.trialPeriodDays;
    }

    if (params.promotionCode) {
      subscriptionParams.discounts = [{ promotion_code: params.promotionCode }];
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
      expand: ["latest_invoice", "default_payment_method", STRIPE_SUBSCRIPTION_DISCOUNT_EXPAND],
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
    promotionCode?: string;
    trialEnd?: "now";
    /** The card the subscription charges from now on (the customer default) */
    defaultPaymentMethodId?: string;
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

    if (params.promotionCode) {
      updateParams.discounts = [{ promotion_code: params.promotionCode }];
    }

    if (params.trialEnd === "now") {
      updateParams.trial_end = "now";
    }

    // A card saved on the subscription by an earlier payment would otherwise beat the customer default
    if (params.defaultPaymentMethodId) {
      updateParams.default_payment_method = params.defaultPaymentMethodId;
    }

    // A change that charges at once (trial upgrade) can leave the invoice open
    // when the card needs 3D Secure; the caller reads the client secret from it
    // The discount is expanded so the caller can store what the subscription carries after the update.
    updateParams.expand = [...SUBSCRIPTION_PAYMENT_EXPAND, STRIPE_SUBSCRIPTION_DISCOUNT_EXPAND];

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
   * Cancel at once an unpaid first-payment attempt that a new attempt replaces, marking it
   * so the webhook knows it never granted anything.
   */
  @HandleStripeErrors()
  async cancelUnpaidAttempt(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = this.stripeService.getClient();
    return stripe.subscriptions.cancel(subscriptionId, {
      cancellation_details: { comment: STRIPE_UNPAID_ATTEMPT_CANCELLATION_COMMENT },
    });
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
   * console.info('Proration amount:', preview.amount_due);
   * ```
   */
  @HandleStripeErrors()
  async previewProration(subscriptionId: string, newPriceId: string): Promise<Stripe.Invoice> {
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
