import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import Stripe from "stripe";
import {
  JsonApiDataInterface,
  JsonApiService,
  StripeCustomerService,
  StripePaymentService,
  StripePortalService,
} from "@carlonicora/nestjs-neo4jsonapi";
import { BillingCustomer } from "../entities/billing-customer.entity";
import { BillingCustomerModel } from "../entities/billing-customer.model";
import { BillingCustomerRepository } from "../repositories/billing-customer.repository";

/**
 * BillingService
 *
 * Orchestrates billing operations for companies by coordinating between Stripe and the local database.
 * Manages customer accounts, payment methods, and provides access to the Stripe Customer Portal.
 *
 * Key Features:
 * - Customer account creation and retrieval linked to company IDs
 * - Payment method management (list, set default, remove)
 * - Setup intent creation for adding new payment methods
 * - Customer portal session generation for self-service billing management
 * - Two-way sync between Stripe and local database
 *
 * This service acts as the main entry point for billing-related operations, ensuring
 * consistency between Stripe's customer data and the local Neo4j database.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly billingCustomerRepository: BillingCustomerRepository,
    private readonly stripeCustomerService: StripeCustomerService,
    private readonly stripePaymentService: StripePaymentService,
    private readonly stripePortalService: StripePortalService,
    private readonly jsonApiService: JsonApiService,
  ) {}

  /**
   * Retrieve billing customer by company ID
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @returns BillingCustomer if found, null otherwise
   *
   * @example
   * ```typescript
   * const customer = await billingService.getCustomerByCompanyId({
   *   companyId: 'company_123'
   * });
   * ```
   */
  async getCustomerByCompanyId(params: { companyId: string }): Promise<BillingCustomer | null> {
    return this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
  }

  /**
   * Retrieve billing customer by company ID or throw error
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @returns BillingCustomer
   * @throws {HttpException} NOT_FOUND if customer does not exist
   *
   * @example
   * ```typescript
   * const customer = await billingService.getCustomerOrFail({
   *   companyId: 'company_123'
   * });
   * ```
   */
  async getCustomerOrFail(params: { companyId: string }): Promise<BillingCustomer> {
    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND);
    }
    return customer;
  }

  /**
   * Create a new billing customer for a company
   *
   * Creates both a Stripe customer and a local database record. The customer is linked
   * to the company and can be used for subscriptions and payments.
   *
   * @param params - Customer creation parameters
   * @param params.companyId - Company identifier to link customer to
   * @param params.name - Customer name
   * @param params.email - Customer email address
   * @param params.currency - Default currency code (e.g., 'usd', 'eur')
   * @returns JSON:API formatted billing customer data
   * @throws {HttpException} CONFLICT if customer already exists for this company
   *
   * @example
   * ```typescript
   * const customer = await billingService.createCustomer({
   *   companyId: 'company_123',
   *   name: 'Acme Corp',
   *   email: 'billing@acme.com',
   *   currency: 'usd'
   * });
   * ```
   */
  async createCustomer(params: {
    companyId: string;
    name: string;
    email: string;
    currency: string;
  }): Promise<JsonApiDataInterface> {
    const existingCustomer = await this.billingCustomerRepository.findByCompanyId({
      companyId: params.companyId,
    });

    if (existingCustomer) {
      throw new HttpException("Billing customer already exists for this company", HttpStatus.CONFLICT);
    }

    const stripeCustomer = await this.stripeCustomerService.createCustomer({
      companyId: params.companyId,
      email: params.email,
      name: params.name,
    });

    const billingCustomer = await this.billingCustomerRepository.create({
      companyId: params.companyId,
      stripeCustomerId: stripeCustomer.id,
      email: params.email,
      name: params.name,
      currency: params.currency,
    });

    return this.jsonApiService.buildSingle(BillingCustomerModel, billingCustomer);
  }

  /**
   * Get billing customer by company ID (JSON:API format)
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @returns JSON:API formatted billing customer data
   * @throws {HttpException} NOT_FOUND if customer does not exist
   *
   * @example
   * ```typescript
   * const customerData = await billingService.getCustomer({
   *   companyId: 'company_123'
   * });
   * ```
   */
  async getCustomer(params: { companyId: string }): Promise<JsonApiDataInterface> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    return this.jsonApiService.buildSingle(BillingCustomerModel, customer);
  }

  /**
   * Create a setup intent for adding payment methods
   *
   * Setup intents are used to collect payment method details without charging the customer.
   * The returned client secret should be used with Stripe.js to complete payment method setup.
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.paymentMethodType - Optional payment method type (default: 'card')
   * @returns Object containing the setup intent client secret
   * @throws {HttpException} NOT_FOUND if customer does not exist
   *
   * @example
   * ```typescript
   * const { clientSecret } = await billingService.createSetupIntent({
   *   companyId: 'company_123'
   * });
   * // Use clientSecret with Stripe.js on frontend
   * ```
   */
  async createSetupIntent(params: {
    companyId: string;
    paymentMethodType?: string;
  }): Promise<{ clientSecret: string }> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    const setupIntent = await this.stripePaymentService.createSetupIntent({
      stripeCustomerId: customer.stripeCustomerId,
    });

    return {
      clientSecret: setupIntent.client_secret,
    };
  }

  /**
   * Create a Stripe Customer Portal session
   *
   * Generates a URL for the Stripe Customer Portal where customers can manage their
   * subscriptions, payment methods, and view billing history.
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.returnUrl - Optional URL to redirect to after portal session ends
   * @returns Object containing the portal session URL
   * @throws {HttpException} NOT_FOUND if customer does not exist
   *
   * @example
   * ```typescript
   * const { url } = await billingService.createPortalSession({
   *   companyId: 'company_123',
   *   returnUrl: 'https://myapp.com/settings/billing'
   * });
   * // Redirect user to the portal URL
   * ```
   */
  async createPortalSession(params: { companyId: string; returnUrl?: string }): Promise<{ url: string }> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    const session = await this.stripePortalService.createPortalSession(customer.stripeCustomerId, params.returnUrl);

    return {
      url: session.url,
    };
  }

  /**
   * List all payment methods for a customer
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @returns Object containing array of Stripe payment methods
   * @throws {HttpException} NOT_FOUND if customer does not exist
   *
   * @example
   * ```typescript
   * const { data } = await billingService.listPaymentMethods({
   *   companyId: 'company_123'
   * });
   * console.log(`Customer has ${data.length} payment methods`);
   * ```
   */
  async listPaymentMethods(params: { companyId: string }): Promise<{ data: Stripe.PaymentMethod[] }> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    const paymentMethods = await this.stripeCustomerService.listPaymentMethods(customer.stripeCustomerId, "card");

    return { data: paymentMethods };
  }

  /**
   * Set the default payment method for a customer
   *
   * Updates both Stripe and the local database to mark the specified payment method
   * as the default for future invoices and subscriptions.
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.paymentMethodId - Stripe payment method ID to set as default
   * @returns Promise that resolves when update is complete
   * @throws {HttpException} NOT_FOUND if customer does not exist
   *
   * @example
   * ```typescript
   * await billingService.setDefaultPaymentMethod({
   *   companyId: 'company_123',
   *   paymentMethodId: 'pm_1234567890'
   * });
   * ```
   */
  async setDefaultPaymentMethod(params: { companyId: string; paymentMethodId: string }): Promise<void> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    await this.stripeCustomerService.updateCustomer({
      stripeCustomerId: customer.stripeCustomerId,
      defaultPaymentMethodId: params.paymentMethodId,
    });

    await this.billingCustomerRepository.update({
      id: customer.id,
      defaultPaymentMethodId: params.paymentMethodId,
    });
  }

  /**
   * Remove a payment method from a customer
   *
   * Detaches the payment method from the customer in Stripe. If the removed payment method
   * was the default, the local database record is updated to clear the default.
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.paymentMethodId - Stripe payment method ID to remove
   * @returns Promise that resolves when removal is complete
   * @throws {HttpException} NOT_FOUND if customer does not exist
   * @throws {HttpException} FORBIDDEN if payment method doesn't belong to customer
   *
   * @example
   * ```typescript
   * await billingService.removePaymentMethod({
   *   companyId: 'company_123',
   *   paymentMethodId: 'pm_1234567890'
   * });
   * ```
   */
  async removePaymentMethod(params: { companyId: string; paymentMethodId: string }): Promise<void> {
    const customer = await this.getCustomerOrFail({ companyId: params.companyId });

    const paymentMethod = await this.stripePaymentService.retrievePaymentMethod(params.paymentMethodId);

    if (paymentMethod.customer !== customer.stripeCustomerId) {
      throw new HttpException("Payment method does not belong to this customer", HttpStatus.FORBIDDEN);
    }

    await this.stripeCustomerService.detachPaymentMethod(params.paymentMethodId);

    if (customer.defaultPaymentMethodId === params.paymentMethodId) {
      await this.billingCustomerRepository.update({
        id: customer.id,
        defaultPaymentMethodId: null,
      });
    }
  }

  /**
   * Sync customer data from Stripe to local database
   *
   * Fetches the latest customer data from Stripe and updates the local database record.
   * Used primarily by webhook handlers to keep data in sync. Silently ignores deleted customers.
   *
   * @param params - Parameters
   * @param params.stripeCustomerId - Stripe customer ID to sync
   * @returns Promise that resolves when sync is complete
   *
   * @example
   * ```typescript
   * // Called from webhook handler
   * await billingService.syncCustomerFromStripe({
   *   stripeCustomerId: 'cus_1234567890'
   * });
   * ```
   */
  async syncCustomerFromStripe(params: { stripeCustomerId: string }): Promise<void> {
    try {
      const stripeCustomer = await this.stripeCustomerService.retrieveCustomer(params.stripeCustomerId);

      const existingCustomer = await this.billingCustomerRepository.findByStripeCustomerId({
        stripeCustomerId: params.stripeCustomerId,
      });

      if (existingCustomer) {
        await this.billingCustomerRepository.updateByStripeCustomerId({
          stripeCustomerId: params.stripeCustomerId,
          email: stripeCustomer.email ?? existingCustomer.email,
          name: stripeCustomer.name ?? existingCustomer.name,
          defaultPaymentMethodId:
            typeof stripeCustomer.invoice_settings?.default_payment_method === "string"
              ? stripeCustomer.invoice_settings.default_payment_method
              : (stripeCustomer.invoice_settings?.default_payment_method as Stripe.PaymentMethod)?.id,
          balance: stripeCustomer.balance,
          delinquent: stripeCustomer.delinquent ?? false,
        });
      }
    } catch (error) {
      // Customer may have been deleted, silently ignore
      if (error instanceof Error && error.message === "Customer has been deleted") {
        return;
      }
      throw error;
    }
  }
}
