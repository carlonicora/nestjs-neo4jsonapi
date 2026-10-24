import { HttpException, HttpStatus, Inject, Injectable, Logger, forwardRef } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import Stripe from "stripe";
import { JsonApiListDocument, JsonApiPaginator, JsonApiService, JsonApiSingleDocument } from "../../../core/jsonapi";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { StripeCustomer } from "../../stripe-customer/entities/stripe-customer.entity";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripeCustomerApiService } from "../../stripe-customer/services/stripe-customer-api.service";
import { StripePrice } from "../../stripe-price/entities/stripe-price.entity";
import { StripePriceRepository } from "../../stripe-price/repositories/stripe-price.repository";
import { StripeCouponCodeCheckoutService } from "../../stripe-coupon/services/stripe-coupon-code-checkout.service";
import { StripeError } from "../../stripe/errors/stripe.errors";
import { StripePaymentService } from "../../stripe/services/stripe.payment.service";
import {
  StripeSubscription,
  StripeSubscriptionDescriptor,
  StripeSubscriptionStatus,
} from "../entities/stripe-subscription";
import { discountFromStripeSubscription } from "../entities/stripe-subscription.discount";
import { StripeSubscriptionRepository } from "../repositories/stripe-subscription.repository";
import { StripeSubscriptionApiService } from "./stripe-subscription-api.service";
import { subscriptionPaymentConfirmation } from "./subscription-payment-confirmation";

export interface CreateSubscriptionResult {
  data: JsonApiSingleDocument;
  clientSecret: string | null;
  paymentIntentId: string | null;
  requiresAction: boolean;
}

/**
 * StripeSubscriptionAdminService
 *
 * Manages subscription lifecycle for billing customers, coordinating between Stripe and the local database.
 * Provides comprehensive subscription management including creation, cancellation,
 * plan changes, and proration previews.
 *
 * Key Features:
 * - Create subscriptions with optional trials and custom quantities
 * - Cancel subscriptions (immediately or at period end)
 * - Change subscription plans with automatic proration
 * - Preview proration amounts before plan changes
 * - Sync subscription data from Stripe webhooks
 * - Filter subscriptions by status (active, canceled, past_due, etc.)
 *
 * All operations update both Stripe and the local Neo4j database to maintain consistency.
 */
@Injectable()
export class StripeSubscriptionAdminService extends AbstractService<
  StripeSubscription,
  typeof StripeSubscriptionDescriptor.relationships
> {
  protected readonly descriptor = StripeSubscriptionDescriptor;
  private readonly logger = new Logger(StripeSubscriptionAdminService.name);

  constructor(
    jsonApiService: JsonApiService,
    private readonly subscriptionRepository: StripeSubscriptionRepository,
    clsService: ClsService,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly stripePriceRepository: StripePriceRepository,
    private readonly stripeSubscriptionApiService: StripeSubscriptionApiService,
    private readonly stripeCustomerApiService: StripeCustomerApiService,
    private readonly stripePaymentService: StripePaymentService,
    @Inject(forwardRef(() => StripeCouponCodeCheckoutService))
    private readonly stripeCouponCodeCheckoutService: StripeCouponCodeCheckoutService,
  ) {
    super(jsonApiService, subscriptionRepository, clsService, StripeSubscriptionDescriptor.model);
  }

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
  }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(params.query);

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND);
    }

    const subscriptions = await this.subscriptionRepository.findByStripeCustomerId({
      stripeCustomerId: customer.id,
      status: params.status,
    });

    return this.jsonApiService.buildList(StripeSubscriptionDescriptor.model, subscriptions, paginator);
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
  async getSubscription(params: { id: string; companyId: string }): Promise<JsonApiSingleDocument> {
    const subscription = await this.subscriptionRepository.findById({ id: params.id });

    if (!subscription) {
      throw new HttpException("Subscription not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || subscription.stripeCustomer?.id !== customer.id) {
      throw new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN);
    }

    return this.jsonApiService.buildSingle(StripeSubscriptionDescriptor.model, subscription);
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
    let existingSubscriptions: StripeSubscription[] = [];
    if (price.priceType === "recurring") {
      existingSubscriptions = await this.subscriptionRepository.findByStripeCustomerId({
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
      // The customer default (the card picked last, e.g. "Use another card"); the first card only without one
      paymentMethodId =
        paymentMethods.find((method) => method.id === customer.defaultPaymentMethodId)?.id ?? paymentMethods[0].id;
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
    // A first payment gets the automatic code only when the server confirms it still applies.
    const { promotionCode, automatic } = await this.resolvePromotionCode({
      companyId: params.companyId,
      priceId: params.priceId,
      promotionCode: params.promotionCode,
      firstPayment: !params.trialPeriodDays && !params.trialEnd,
    });

    // An earlier attempt that was never paid (declined card, failed 3D Secure) is
    // cancelled first, so retries do not pile up unpaid subscriptions
    await this.cancelUnpaidRecurringSubscriptions(existingSubscriptions);

    const stripeSubscription: Stripe.Subscription = await this.withDiscountSoldOutMapping(
      automatic,
      promotionCode,
      () =>
        this.stripeSubscriptionApiService.createSubscription({
          stripeCustomerId: customer.stripeCustomerId,
          priceId: price.stripePriceId,
          paymentMethodId,
          trialPeriodDays: params.trialPeriodDays,
          trialEnd: params.trialEnd,
          metadata: {
            companyId: params.companyId,
            priceId: params.priceId,
          },
          promotionCode,
        }),
    );

    if (promotionCode) await this.stripeCouponCodeCheckoutService.refreshCountsByStripePromotionCodeId(promotionCode);

    // Payment details the browser needs to confirm the first payment (SCA)
    const { clientSecret, paymentIntentId, requiresAction } = subscriptionPaymentConfirmation(stripeSubscription);

    const subscriptionItem = stripeSubscription.items.data[0];
    const subscription = await this.subscriptionRepository.createSubscription({
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
      discount: discountFromStripeSubscription(stripeSubscription),
    });

    const data = await this.jsonApiService.buildSingle(StripeSubscriptionDescriptor.model, subscription);

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
  }): Promise<JsonApiSingleDocument> {
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

    const updatedSubscription = await this.storeCancellation(params.id, stripeSubscription);

    return this.jsonApiService.buildSingle(StripeSubscriptionDescriptor.model, updatedSubscription);
  }

  /**
   * Stores the cancellation Stripe answered with on our subscription node.
   */
  private async storeCancellation(id: string, stripeSubscription: Stripe.Subscription): Promise<StripeSubscription> {
    return this.subscriptionRepository.update({
      id,
      status: stripeSubscription.status as StripeSubscriptionStatus,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      canceledAt: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000) : undefined,
    });
  }

  /**
   * Cancels, in Stripe and at once, every recurring subscription of the customer that is
   * still `incomplete`: a first payment that never went through. Active, trialing and
   * past_due subscriptions are never touched, nor one-time purchases (their node holds a
   * PaymentIntent id, not a subscription id).
   *
   * A failed cancellation never blocks the new subscription: the node is re-read from
   * Stripe instead (an attempt older than 23 hours is already `incomplete_expired`).
   */
  private async cancelUnpaidRecurringSubscriptions(subscriptions: StripeSubscription[]): Promise<void> {
    const unpaid = subscriptions.filter(
      (sub) => sub.status === "incomplete" && sub.stripePrice?.priceType === "recurring" && sub.stripeSubscriptionId,
    );

    for (const sub of unpaid) {
      try {
        const stripeSubscription = await this.stripeSubscriptionApiService.cancelUnpaidAttempt(
          sub.stripeSubscriptionId,
        );
        await this.storeCancellation(sub.id, stripeSubscription);
      } catch (error) {
        this.logger.warn(
          `Could not cancel unpaid subscription ${sub.stripeSubscriptionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        try {
          await this.syncSubscriptionFromStripe({ stripeSubscriptionId: sub.stripeSubscriptionId });
        } catch (syncError) {
          this.logger.warn(
            `Could not re-read unpaid subscription ${sub.stripeSubscriptionId}: ${syncError instanceof Error ? syncError.message : String(syncError)}`,
          );
        }
      }
    }
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
  }): Promise<JsonApiSingleDocument> {
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

    // The subscription charges the customer default from now on: a card saved on the
    // subscription by an earlier payment would otherwise beat a card added since
    let defaultPaymentMethodId: string | undefined = customer.defaultPaymentMethodId || undefined;

    // For trial upgrades, require a payment method
    if (isTrialUpgrade) {
      const paymentMethods = await this.stripeCustomerApiService.listPaymentMethods(customer.stripeCustomerId);
      if (paymentMethods.length === 0) {
        throw new HttpException("A payment method is required to upgrade from trial", HttpStatus.PAYMENT_REQUIRED);
      }
      // A default that is no longer attached is not sent
      if (!paymentMethods.some((method) => method.id === defaultPaymentMethodId)) defaultPaymentMethodId = undefined;
    }

    // Paying for a trial is a first payment and can get the automatic code.
    // A paid plan change sends no code unless the GM typed one, so an existing discount stays.
    const { promotionCode, automatic } = await this.resolvePromotionCode({
      companyId: params.companyId,
      priceId: params.newPriceId,
      promotionCode: params.promotionCode,
      firstPayment: isTrialUpgrade,
    });

    // Update with trial_end: 'now' for trial upgrades
    const stripeSubscription: Stripe.Subscription = await this.withDiscountSoldOutMapping(
      automatic,
      promotionCode,
      () =>
        this.stripeSubscriptionApiService.updateSubscription({
          subscriptionId: subscription.stripeSubscriptionId,
          priceId: newPrice.stripePriceId,
          prorationBehavior: isTrialUpgrade ? "none" : "create_prorations",
          promotionCode,
          trialEnd: isTrialUpgrade ? "now" : undefined,
          defaultPaymentMethodId,
        }),
    );

    if (promotionCode) await this.stripeCouponCodeCheckoutService.refreshCountsByStripePromotionCodeId(promotionCode);

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
      discount: discountFromStripeSubscription(stripeSubscription),
    });

    const document = await this.jsonApiService.buildSingle(StripeSubscriptionDescriptor.model, updatedSubscription);

    // A trial upgrade charges at once; a card that asks for 3D Secure leaves the
    // invoice open. The browser confirms it with the client secret in meta.
    const confirmation = subscriptionPaymentConfirmation(stripeSubscription);
    if (!confirmation.requiresAction) return document;

    return { ...document, meta: { ...document.meta, ...confirmation } };
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
    const prorationPreview: Stripe.Invoice = await this.stripeSubscriptionApiService.previewProration(
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
        discount: discountFromStripeSubscription(stripeSubscription),
      });
    }
  }

  /**
   * Create a one-time purchase charged through a Stripe invoice
   *
   * Unlike recurring subscriptions, one-time purchases:
   * - Are charged through a one-off invoice instead of the Subscription API
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

    // Charge the one-time price through an invoice so the customer gets an invoice
    const { paymentIntent: confirmedPaymentIntent } = await this.stripePaymentService.createAndPayOneTimeInvoice({
      stripeCustomerId: customer.stripeCustomerId,
      stripePriceId: price.stripePriceId,
      quantity,
      currency: price.currency,
      description: price.description ?? `One-time purchase: ${price.nickname ?? priceId}`,
      metadata: {
        companyId,
        priceId,
        type: "one_time_purchase",
      },
      paymentMethodId,
    });

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
    const subscription = await this.subscriptionRepository.createSubscription({
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

    const data = await this.jsonApiService.buildSingle(StripeSubscriptionDescriptor.model, subscription);

    return {
      data,
      clientSecret,
      paymentIntentId: confirmedPaymentIntent.id,
      requiresAction,
    };
  }

  /**
   * Decides which promotion code goes to Stripe and whether it is our automatic code.
   * - No code sent: on a first payment the server attaches the automatic code when it applies.
   * - Our automatic code sent (the review showed it): it goes to Stripe only when it still applies.
   *   Otherwise the payment stops here, so the GM is never charged full price silently:
   *   410 `discount_sold_out` when the places ran out, 422 `discount_unavailable` for any other reason.
   * - Any other code (typed, or not ours): passed to Stripe unchanged.
   */
  private async resolvePromotionCode(params: {
    companyId: string;
    priceId: string;
    promotionCode?: string;
    firstPayment: boolean;
  }): Promise<{ promotionCode: string | undefined; automatic: boolean }> {
    if (!params.promotionCode) {
      if (!params.firstPayment) return { promotionCode: undefined, automatic: false };
      const code = await this.stripeCouponCodeCheckoutService.findAutomaticForPrice({
        companyId: params.companyId,
        priceId: params.priceId,
      });
      return { promotionCode: code?.stripePromotionCodeId, automatic: !!code };
    }

    const status = await this.stripeCouponCodeCheckoutService.checkAutomaticForPrice({
      companyId: params.companyId,
      priceId: params.priceId,
      stripePromotionCodeId: params.promotionCode,
      firstPayment: params.firstPayment,
    });

    switch (status) {
      case "eligible":
        return { promotionCode: params.promotionCode, automatic: true };
      case "sold_out":
        throw new HttpException(
          { message: "The discount has no places left", code: "discount_sold_out" },
          HttpStatus.GONE,
        );
      case "unavailable":
        throw new HttpException(
          { message: "The discount is no longer available", code: "discount_unavailable" },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      case "not_automatic":
        return { promotionCode: params.promotionCode, automatic: false };
    }
  }

  /**
   * Runs a Stripe call. When it carries our automatic code and Stripe refuses it because the code
   * has no places left (two GMs on the last place), answers 410 `discount_sold_out`; Stripe
   * refused the whole call, so nothing was charged. A typed code, and any other failure, is
   * re-thrown unchanged: the "last founding place" message is only true for the automatic code.
   */
  private async withDiscountSoldOutMapping<T>(
    automatic: boolean,
    promotionCode: string | undefined,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof StripeError) || !automatic || !promotionCode) throw error;

      let exhausted = false;
      try {
        exhausted = await this.stripeCouponCodeCheckoutService.isExhausted(promotionCode);
      } catch {
        throw error;
      }

      if (exhausted) {
        throw new HttpException(
          { message: "The discount has no places left", code: "discount_sold_out" },
          HttpStatus.GONE,
        );
      }
      throw error;
    }
  }
}
