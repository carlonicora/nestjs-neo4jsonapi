import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { JsonApiDataInterface, JsonApiPaginator, JsonApiService } from "../../../core/jsonapi";
import { StripeCustomer } from "../../stripe-customer/entities/stripe-customer.entity";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripeCustomerApiService } from "../../stripe-customer/services/stripe-customer-api.service";
import { StripePrice } from "../../stripe-price/entities/stripe-price.entity";
import { StripePriceRepository } from "../../stripe-price/repositories/stripe-price.repository";
import { StripePaymentService } from "../../stripe/services/stripe.payment.service";
import { StripeSubscriptionStatus } from "../entities/stripe-subscription.entity";
import { StripeSubscriptionModel } from "../entities/stripe-subscription.model";
import { StripeSubscriptionRepository } from "../repositories/stripe-subscription.repository";
import { StripeSubscriptionApiService } from "./stripe-subscription-api.service";

export interface CreateSubscriptionResult {
  data: JsonApiDataInterface;
  clientSecret: string | null;
  paymentIntentId: string | null;
  requiresAction: boolean;
}

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
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly stripePriceRepository: StripePriceRepository,
    private readonly stripeSubscriptionApiService: StripeSubscriptionApiService,
    private readonly stripeCustomerApiService: StripeCustomerApiService,
    private readonly stripePaymentService: StripePaymentService,
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

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND);
    }

    const subscriptions = await this.subscriptionRepository.findByStripeCustomerId({
      stripeCustomerId: customer.id,
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

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.stripeCustomer?.id !== customer.id) {
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
   * @param params.trialPeriodDays - Optional trial period in days (ignored if trialEnd is set)
   * @param params.trialEnd - Optional Unix timestamp for trial end (takes precedence over trialPeriodDays)
   * @param params.quantity - Optional quantity (default: 1)
   * @returns JSON:API formatted subscription data
   * @throws {HttpException} NOT_FOUND if customer or price not found
   * @throws {HttpException} PAYMENT_REQUIRED (402) if no payment methods exist
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
    trialEnd?: number; // Unix timestamp - takes precedence over trialPeriodDays
    quantity?: number;
    promotionCode?: string;
  }): Promise<CreateSubscriptionResult> {
    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND);
    }

    const price = await this.stripePriceRepository.findById({ id: params.priceId });
    if (!price) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    // Prevent duplicate recurring subscriptions
    if (price.priceType === "recurring") {
      const existingSubscriptions = await this.subscriptionRepository.findByStripeCustomerId({
        stripeCustomerId: customer.id,
      });

      const hasActiveRecurring = existingSubscriptions.some(
        (sub) => (sub.status === "active" || sub.status === "trialing") && sub.stripePrice?.priceType === "recurring",
      );

      if (hasActiveRecurring) {
        throw new HttpException(
          "You already have an active subscription. Please change your plan instead of creating a new one.",
          HttpStatus.CONFLICT,
        );
      }
    }

    // Validate and auto-select payment method
    // For trial subscriptions, payment method is optional
    const isTrial = params.trialPeriodDays || params.trialEnd;
    let paymentMethodId = params.paymentMethodId;
    if (!paymentMethodId && !isTrial) {
      const paymentMethods = await this.stripeCustomerApiService.listPaymentMethods(customer.stripeCustomerId);
      if (paymentMethods.length === 0) {
        throw new HttpException(
          "No payment method available. Please add a payment method before creating a subscription.",
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      paymentMethodId = paymentMethods[0].id;
    }

    // Branch based on price type: one-time vs recurring
    if (price.priceType === "one_time") {
      return this.createOneTimePurchase({
        customer,
        price,
        paymentMethodId,
        companyId: params.companyId,
        priceId: params.priceId,
        quantity: params.quantity ?? 1,
      });
    }

    // Recurring subscription flow
    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionApiService.createSubscription({
      stripeCustomerId: customer.stripeCustomerId,
      priceId: price.stripePriceId,
      paymentMethodId,
      trialPeriodDays: params.trialPeriodDays,
      trialEnd: params.trialEnd,
      metadata: {
        companyId: params.companyId,
        priceId: params.priceId,
      },
      promotionCode: params.promotionCode,
    });

    // Extract payment intent details for SCA confirmation
    let clientSecret: string | null = null;
    let paymentIntentId: string | null = null;
    const latestInvoice = stripeSubscription.latest_invoice;
    if (latestInvoice && typeof latestInvoice !== "string") {
      const invoice = latestInvoice as Stripe.Invoice & { payment_intent?: string | Stripe.PaymentIntent | null };
      const paymentIntent = invoice.payment_intent;
      if (paymentIntent && typeof paymentIntent !== "string") {
        clientSecret = paymentIntent.client_secret;
        paymentIntentId = paymentIntent.id;
      }
    }

    const requiresAction = stripeSubscription.status === "incomplete" && clientSecret !== null;

    const subscriptionItem = stripeSubscription.items.data[0];
    const subscription = await this.subscriptionRepository.create({
      stripeCustomerId: customer.id,
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

    const data = await this.jsonApiService.buildSingle(StripeSubscriptionModel, subscription);

    return {
      data,
      clientSecret,
      paymentIntentId,
      requiresAction,
    };
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

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.stripeCustomer?.id !== customer.id) {
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

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.stripeCustomer?.id !== customer.id) {
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

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.stripeCustomer?.id !== customer.id) {
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
  async changePlan(params: {
    id: string;
    companyId: string;
    newPriceId: string;
    promotionCode?: string;
  }): Promise<JsonApiDataInterface> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.stripeCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const newPrice = await this.stripePriceRepository.findById({ id: params.newPriceId });
    if (!newPrice) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    // Check if subscription is in trial status
    const isTrialUpgrade = subscription.status === "trialing";

    // For trial upgrades, require a payment method
    if (isTrialUpgrade) {
      const paymentMethods = await this.stripeCustomerApiService.listPaymentMethods(customer.stripeCustomerId);
      if (paymentMethods.length === 0) {
        throw new HttpException("A payment method is required to upgrade from trial", HttpStatus.PAYMENT_REQUIRED);
      }
    }

    // Update with trial_end: 'now' for trial upgrades
    const stripeSubscription: Stripe.Subscription = await this.stripeSubscriptionApiService.updateSubscription({
      subscriptionId: subscription.stripeSubscriptionId,
      priceId: newPrice.stripePriceId,
      prorationBehavior: isTrialUpgrade ? "none" : "create_prorations",
      promotionCode: params.promotionCode,
      trialEnd: isTrialUpgrade ? "now" : undefined,
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
   * console.info(`Proration amount: ${preview.amountDue}`);
   * ```
   */
  async previewProration(params: { id: string; companyId: string; newPriceId: string }): Promise<any> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.stripeCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    const newPrice = await this.stripePriceRepository.findById({ id: params.newPriceId });
    if (!newPrice) {
      throw new HttpException("Price not found", HttpStatus.NOT_FOUND);
    }

    // Check if subscription is in trial status
    const isTrialUpgrade = subscription.status === "trialing";

    // For trial upgrades, return full price (not proration)
    if (isTrialUpgrade) {
      const fullPrice = newPrice.unitAmount ?? 0;

      // Calculate period end based on billing interval
      const now = new Date();
      const periodEnd = new Date(now);
      if (newPrice.recurringInterval === "year") {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      return {
        subtotal: fullPrice,
        total: fullPrice,
        amountDue: fullPrice,
        immediateCharge: fullPrice,
        currency: newPrice.currency,
        prorationDate: now,
        isTrialUpgrade: true,
        lines: [
          {
            description: `${newPrice.stripeProduct?.name ?? "Subscription"} - Full price (trial ends)`,
            amount: fullPrice,
            proration: false,
            period: { start: now, end: periodEnd },
          },
        ],
      };
    }

    // Existing proration logic for non-trial subscriptions
    const prorationPreview: Stripe.UpcomingInvoice = await this.stripeSubscriptionApiService.previewProration(
      subscription.stripeSubscriptionId,
      newPrice.stripePriceId,
    );

    // Calculate immediate charge from proration line items only
    // This represents the net amount charged NOW for the plan change
    const immediateCharge = prorationPreview.lines.data
      .filter((line: Stripe.InvoiceLineItem) => (line as any).proration === true)
      .reduce((sum: number, line: Stripe.InvoiceLineItem) => sum + line.amount, 0);

    return {
      subtotal: prorationPreview.subtotal,
      total: prorationPreview.total,
      amountDue: prorationPreview.amount_due,
      immediateCharge,
      currency: prorationPreview.currency,
      prorationDate: new Date(),
      isTrialUpgrade: false,
      lines: prorationPreview.lines.data.map((line: Stripe.InvoiceLineItem) => ({
        description: line.description,
        amount: line.amount,
        proration: (line as any).proration,
        period: {
          start: line.period?.start ? new Date(line.period.start * 1000) : new Date(),
          end: line.period?.end ? new Date(line.period.end * 1000) : new Date(),
        },
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

  /**
   * Create a one-time purchase using PaymentIntent flow
   *
   * Unlike recurring subscriptions, one-time purchases:
   * - Use PaymentIntent API instead of Subscription API
   * - Don't block or get blocked by existing subscriptions
   * - Store as StripeSubscription record with PaymentIntent ID
   *
   * @param params - Purchase parameters
   * @returns CreateSubscriptionResult with purchase data
   */
  private async createOneTimePurchase(params: {
    customer: StripeCustomer;
    price: StripePrice;
    paymentMethodId: string;
    companyId: string;
    priceId: string;
    quantity: number;
  }): Promise<CreateSubscriptionResult> {
    const { customer, price, paymentMethodId, companyId, priceId, quantity } = params;

    // Create PaymentIntent for the one-time amount
    const paymentIntent = await this.stripePaymentService.createPaymentIntent({
      amount: (price.unitAmount ?? 0) * quantity,
      currency: price.currency,
      stripeCustomerId: customer.stripeCustomerId,
      metadata: {
        companyId,
        priceId,
        type: "one_time_purchase",
      },
      description: price.description ?? `One-time purchase: ${price.nickname ?? priceId}`,
    });

    // Confirm the PaymentIntent with the payment method
    const confirmedPaymentIntent = await this.stripePaymentService.confirmPaymentIntent(
      paymentIntent.id,
      paymentMethodId,
    );

    // Determine status and if SCA is required
    let clientSecret: string | null = null;
    let status: StripeSubscriptionStatus;

    if (confirmedPaymentIntent.status === "succeeded") {
      status = "active";
    } else if (confirmedPaymentIntent.status === "requires_action") {
      status = "incomplete";
      clientSecret = confirmedPaymentIntent.client_secret;
    } else {
      status = "incomplete";
    }

    const requiresAction = status === "incomplete" && clientSecret !== null;

    // Create a "subscription" record to track the purchase
    // Note: stripeSubscriptionId stores the PaymentIntent ID for one-time purchases
    const now = new Date();
    const subscription = await this.subscriptionRepository.create({
      stripeCustomerId: customer.id,
      priceId: priceId,
      stripeSubscriptionId: confirmedPaymentIntent.id, // Store PaymentIntent ID
      stripeSubscriptionItemId: undefined, // No subscription item for one-time
      status: status,
      currentPeriodStart: now,
      currentPeriodEnd: now, // One-time purchases don't have a period
      cancelAtPeriodEnd: false,
      quantity: quantity,
    });

    const data = await this.jsonApiService.buildSingle(StripeSubscriptionModel, subscription);

    return {
      data,
      clientSecret,
      paymentIntentId: confirmedPaymentIntent.id,
      requiresAction,
    };
  }
}
