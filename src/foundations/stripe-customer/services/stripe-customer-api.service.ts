import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "../../stripe/services/stripe.service";
import { HandleStripeErrors } from "../../stripe/errors/stripe.errors";

/**
 * Stripe Customer API Service
 *
 * Manages Stripe customer operations including creation, retrieval, updates, and payment method management.
 * Provides a thin wrapper around Stripe's customer API with error handling and company metadata integration.
 *
 * @example
 * ```typescript
 * const customer = await stripeCustomerApiService.createCustomer({
 *   companyId: 'company_123',
 *   email: 'user@example.com',
 *   name: 'John Doe',
 * });
 * ```
 */
@Injectable()
export class StripeCustomerApiService {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Create a new Stripe customer
   *
   * @param params - Customer creation parameters
   * @param params.companyId - Internal company ID (stored in metadata)
   * @param params.email - Customer email address
   * @param params.name - Customer name
   * @param params.metadata - Additional metadata to store with the customer
   * @returns Promise resolving to the created Stripe customer
   * @throws {StripeError} If customer creation fails
   *
   * @example
   * ```typescript
   * const customer = await service.createCustomer({
   *   companyId: 'company_123',
   *   email: 'user@example.com',
   *   name: 'John Doe',
   * });
   * ```
   */
  @HandleStripeErrors()
  async createCustomer(params: {
    companyId: string;
    email: string;
    name: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    const stripe = this.stripeService.getClient();
    return stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: { companyId: params.companyId, ...params.metadata },
    });
  }

  /**
   * Retrieve a Stripe customer by ID
   *
   * @param stripeCustomerId - The Stripe customer ID
   * @returns Promise resolving to the Stripe customer object
   * @throws {Error} If the customer has been deleted
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const customer = await service.retrieveCustomer('cus_abc123');
   * ```
   */
  @HandleStripeErrors()
  async retrieveCustomer(stripeCustomerId: string): Promise<Stripe.Customer> {
    const stripe = this.stripeService.getClient();
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if (customer.deleted) {
      throw new Error("Customer has been deleted");
    }
    return customer as Stripe.Customer;
  }

  /**
   * Update a Stripe customer's information
   *
   * @param params - Customer update parameters
   * @param params.stripeCustomerId - The Stripe customer ID
   * @param params.email - New email address (optional)
   * @param params.name - New name (optional)
   * @param params.defaultPaymentMethodId - New default payment method ID (optional)
   * @param params.metadata - Updated metadata (optional)
   * @returns Promise resolving to the updated Stripe customer
   * @throws {StripeError} If update fails
   *
   * @example
   * ```typescript
   * const customer = await service.updateCustomer({
   *   stripeCustomerId: 'cus_abc123',
   *   email: 'newemail@example.com',
   *   defaultPaymentMethodId: 'pm_xyz789',
   * });
   * ```
   */
  @HandleStripeErrors()
  async updateCustomer(params: {
    stripeCustomerId: string;
    email?: string;
    name?: string;
    defaultPaymentMethodId?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    const stripe = this.stripeService.getClient();
    const updateData: Stripe.CustomerUpdateParams = {};
    if (params.email) updateData.email = params.email;
    if (params.name) updateData.name = params.name;
    if (params.defaultPaymentMethodId) {
      updateData.invoice_settings = { default_payment_method: params.defaultPaymentMethodId };
    }
    if (params.metadata) updateData.metadata = params.metadata;
    return stripe.customers.update(params.stripeCustomerId, updateData);
  }

  /**
   * Delete a Stripe customer
   *
   * @param stripeCustomerId - The Stripe customer ID to delete
   * @returns Promise resolving to the deleted customer confirmation
   * @throws {StripeError} If deletion fails
   *
   * @example
   * ```typescript
   * const deleted = await service.deleteCustomer('cus_abc123');
   * ```
   *
   * @remarks
   * This is a permanent action. Consider deactivating or archiving the customer instead.
   */
  @HandleStripeErrors()
  async deleteCustomer(stripeCustomerId: string): Promise<Stripe.DeletedCustomer> {
    const stripe = this.stripeService.getClient();
    return stripe.customers.del(stripeCustomerId);
  }

  /**
   * List payment methods attached to a customer
   *
   * @param stripeCustomerId - The Stripe customer ID
   * @param type - Type of payment method to list (default: "card")
   * @returns Promise resolving to array of payment methods
   * @throws {StripeError} If listing fails
   *
   * @example
   * ```typescript
   * const paymentMethods = await service.listPaymentMethods('cus_abc123', 'card');
   * ```
   */
  @HandleStripeErrors()
  async listPaymentMethods(
    stripeCustomerId: string,
    type: Stripe.PaymentMethodListParams.Type = "card",
  ): Promise<Stripe.PaymentMethod[]> {
    const stripe = this.stripeService.getClient();
    const paymentMethods = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type,
    });
    return paymentMethods.data;
  }

  /**
   * Set the default payment method for a customer
   *
   * @param stripeCustomerId - The Stripe customer ID
   * @param paymentMethodId - The payment method ID to set as default
   * @returns Promise resolving to the updated customer
   * @throws {StripeError} If update fails
   *
   * @example
   * ```typescript
   * const customer = await service.setDefaultPaymentMethod('cus_abc123', 'pm_xyz789');
   * ```
   */
  @HandleStripeErrors()
  async setDefaultPaymentMethod(stripeCustomerId: string, paymentMethodId: string): Promise<Stripe.Customer> {
    const stripe = this.stripeService.getClient();
    return stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  /**
   * The card a subscription will be charged on: the subscription's own default payment
   * method, else the customer's invoice default.
   *
   * @returns The card details, or null when neither default is a card
   * @throws {StripeError} If a Stripe call fails
   */
  @HandleStripeErrors()
  async getDefaultCard(params: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  }): Promise<{ brand: string; last4: string; expMonth: number; expYear: number } | null> {
    const stripe = this.stripeService.getClient();

    const subscription = await stripe.subscriptions.retrieve(params.stripeSubscriptionId, {
      expand: ["default_payment_method"],
    });
    const subscriptionCard = this.cardOf(subscription.default_payment_method);
    if (subscriptionCard) return subscriptionCard;

    const customer = await stripe.customers.retrieve(params.stripeCustomerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return null;
    return this.cardOf((customer as Stripe.Customer).invoice_settings?.default_payment_method ?? null);
  }

  private cardOf(
    paymentMethod: string | Stripe.PaymentMethod | null | undefined,
  ): { brand: string; last4: string; expMonth: number; expYear: number } | null {
    if (!paymentMethod || typeof paymentMethod === "string") return null;
    if (paymentMethod.type !== "card" || !paymentMethod.card) return null;
    return {
      brand: paymentMethod.card.brand,
      last4: paymentMethod.card.last4,
      expMonth: paymentMethod.card.exp_month,
      expYear: paymentMethod.card.exp_year,
    };
  }

  /**
   * Detach a payment method from its customer
   *
   * @param paymentMethodId - The payment method ID to detach
   * @returns Promise resolving to the detached payment method
   * @throws {StripeError} If detachment fails
   *
   * @example
   * ```typescript
   * const paymentMethod = await service.detachPaymentMethod('pm_xyz789');
   * ```
   */
  @HandleStripeErrors()
  async detachPaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    const stripe = this.stripeService.getClient();
    return stripe.paymentMethods.detach(paymentMethodId);
  }
}
