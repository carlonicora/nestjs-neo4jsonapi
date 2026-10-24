import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

/**
 * Stripe Payment Service
 *
 * Manages payment intents, setup intents, and payment methods. Handles one-time payments
 * and payment method setup for future use. Supports automatic payment methods.
 *
 * @example
 * ```typescript
 * const paymentIntent = await stripePaymentService.createPaymentIntent({
 *   amount: 5000,
 *   currency: 'usd',
 *   stripeCustomerId: 'cus_abc123',
 * });
 *
 * const setupIntent = await stripePaymentService.createSetupIntent({
 *   stripeCustomerId: 'cus_abc123',
 * });
 * ```
 */
@Injectable()
export class StripePaymentService {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Create a payment intent for a one-time payment
   *
   * @param params - Payment intent parameters
   * @param params.amount - Amount in cents
   * @param params.currency - Three-letter currency code
   * @param params.stripeCustomerId - Stripe customer ID
   * @param params.metadata - Additional metadata (optional)
   * @param params.description - Payment description (optional)
   * @param params.receiptEmail - Email for receipt (optional)
   * @returns Promise resolving to the created payment intent
   * @throws {StripeError} If payment intent creation fails
   *
   * @example
   * ```typescript
   * const paymentIntent = await service.createPaymentIntent({
   *   amount: 5000,
   *   currency: 'usd',
   *   stripeCustomerId: 'cus_abc123',
   *   description: 'One-time purchase',
   * });
   * ```
   */
  @HandleStripeErrors()
  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    stripeCustomerId: string;
    metadata?: Record<string, string>;
    description?: string;
    receiptEmail?: string;
  }): Promise<Stripe.PaymentIntent> {
    const stripe = this.stripeService.getClient();

    return stripe.paymentIntents.create({
      amount: params.amount,
      currency: params.currency,
      customer: params.stripeCustomerId,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: params.metadata,
      description: params.description,
      receipt_email: params.receiptEmail,
    });
  }

  /**
   * Retrieve a payment intent by ID
   *
   * @param paymentIntentId - The payment intent ID
   * @returns Promise resolving to the payment intent
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const paymentIntent = await service.retrievePaymentIntent('pi_abc123');
   * ```
   */
  @HandleStripeErrors()
  async retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    const stripe = this.stripeService.getClient();
    return stripe.paymentIntents.retrieve(paymentIntentId);
  }

  /**
   * Create a setup intent for saving payment methods for future use
   *
   * @param params - Setup intent parameters
   * @param params.stripeCustomerId - Stripe customer ID
   * @param params.metadata - Additional metadata (optional)
   * @param params.usage - Intended usage (on_session or off_session) (optional)
   * @returns Promise resolving to the created setup intent
   * @throws {StripeError} If setup intent creation fails
   *
   * @example
   * ```typescript
   * const setupIntent = await service.createSetupIntent({
   *   stripeCustomerId: 'cus_abc123',
   *   usage: 'off_session',
   * });
   * ```
   */
  @HandleStripeErrors()
  async createSetupIntent(params: {
    stripeCustomerId: string;
    metadata?: Record<string, string>;
    usage?: "on_session" | "off_session";
  }): Promise<Stripe.SetupIntent> {
    const stripe = this.stripeService.getClient();

    return stripe.setupIntents.create({
      customer: params.stripeCustomerId,
      automatic_payment_methods: { enabled: true },
      metadata: params.metadata,
      usage: params.usage || "off_session",
    });
  }

  /**
   * Retrieve a setup intent by ID
   *
   * @param setupIntentId - The setup intent ID
   * @returns Promise resolving to the setup intent
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const setupIntent = await service.retrieveSetupIntent('seti_abc123');
   * ```
   */
  @HandleStripeErrors()
  async retrieveSetupIntent(setupIntentId: string): Promise<Stripe.SetupIntent> {
    const stripe = this.stripeService.getClient();
    return stripe.setupIntents.retrieve(setupIntentId);
  }

  /**
   * Confirm a payment intent with a payment method
   *
   * @param paymentIntentId - The payment intent ID to confirm
   * @param paymentMethodId - The payment method ID to use
   * @returns Promise resolving to the confirmed payment intent
   * @throws {StripeError} If confirmation fails
   *
   * @example
   * ```typescript
   * const paymentIntent = await service.confirmPaymentIntent('pi_abc123', 'pm_xyz789');
   * ```
   */
  @HandleStripeErrors()
  async confirmPaymentIntent(paymentIntentId: string, paymentMethodId: string): Promise<Stripe.PaymentIntent> {
    const stripe = this.stripeService.getClient();
    return stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethodId,
    });
  }

  /**
   * Cancel a payment intent
   *
   * @param paymentIntentId - The payment intent ID to cancel
   * @returns Promise resolving to the canceled payment intent
   * @throws {StripeError} If cancellation fails
   *
   * @example
   * ```typescript
   * const paymentIntent = await service.cancelPaymentIntent('pi_abc123');
   * ```
   */
  @HandleStripeErrors()
  async cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    const stripe = this.stripeService.getClient();
    return stripe.paymentIntents.cancel(paymentIntentId);
  }

  /**
   * Charge a one-time price through a Stripe invoice, so the customer gets an invoice
   * and receipt for the purchase.
   *
   * Creates a draft invoice, adds the price as an invoice item, finalizes it, copies the
   * metadata onto the invoice's payment intent and pays it with the given payment method.
   * When the card needs authentication the payment intent is returned with
   * `status: "requires_action"` instead of throwing. Any other payment failure voids the
   * invoice and rethrows.
   *
   * @param params - Purchase parameters
   * @param params.stripeCustomerId - Stripe customer ID
   * @param params.stripePriceId - Stripe price ID of the one-time price
   * @param params.quantity - Number of units
   * @param params.currency - Three-letter currency code
   * @param params.description - Invoice description
   * @param params.metadata - Metadata written on the invoice and on its payment intent
   * @param params.paymentMethodId - Payment method used to pay the invoice
   * @returns The invoice ID and the invoice's payment intent after the payment attempt
   * @throws {StripeError} If invoice creation or payment fails
   */
  @HandleStripeErrors()
  async createAndPayOneTimeInvoice(params: {
    stripeCustomerId: string;
    stripePriceId: string;
    quantity: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    paymentMethodId: string;
  }): Promise<{ invoiceId: string; paymentIntent: Stripe.PaymentIntent }> {
    const stripe = this.stripeService.getClient();

    const draft = await stripe.invoices.create({
      customer: params.stripeCustomerId,
      collection_method: "charge_automatically",
      auto_advance: false,
      currency: params.currency,
      description: params.description,
      metadata: params.metadata,
    });
    const invoiceId = draft.id;

    await stripe.invoiceItems.create({
      customer: params.stripeCustomerId,
      invoice: invoiceId,
      pricing: { price: params.stripePriceId },
      quantity: params.quantity,
    });

    const finalized = await stripe.invoices.finalizeInvoice(invoiceId, {
      expand: ["payments.data.payment.payment_intent"],
    });

    const invoicePaymentIntent = finalized.payments?.data[0]?.payment.payment_intent;
    const paymentIntentId = typeof invoicePaymentIntent === "string" ? invoicePaymentIntent : invoicePaymentIntent?.id;
    if (!paymentIntentId) {
      await stripe.invoices.voidInvoice(invoiceId);
      throw new Error(`Invoice ${invoiceId} has no payment intent after finalization`);
    }

    await stripe.paymentIntents.update(paymentIntentId, { metadata: params.metadata });

    try {
      await stripe.invoices.pay(invoiceId, { payment_method: params.paymentMethodId });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "invoice_payment_intent_requires_action") {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        return { invoiceId, paymentIntent };
      }
      await stripe.invoices.voidInvoice(invoiceId);
      throw error;
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return { invoiceId, paymentIntent };
  }

  /**
   * Retrieve a payment method by ID
   *
   * @param paymentMethodId - The payment method ID
   * @returns Promise resolving to the payment method
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const paymentMethod = await service.retrievePaymentMethod('pm_abc123');
   * ```
   */
  @HandleStripeErrors()
  async retrievePaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    const stripe = this.stripeService.getClient();
    return stripe.paymentMethods.retrieve(paymentMethodId);
  }
}
