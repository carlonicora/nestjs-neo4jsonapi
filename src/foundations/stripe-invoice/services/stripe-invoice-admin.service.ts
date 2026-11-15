import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import Stripe from "stripe";
import { JsonApiPaginator, JsonApiService, JsonApiListDocument, JsonApiSingleDocument } from "../../../core/jsonapi";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeInvoiceStatus } from "../entities/stripe-invoice.entity";
import { StripeInvoiceModel } from "../entities/stripe-invoice.model";
import { StripeInvoiceRepository } from "../repositories/stripe-invoice.repository";
import { readServiceLines } from "../utils/invoice-service-lines";
import { StripeInvoiceApiService } from "./stripe-invoice-api.service";

/**
 * StripeInvoiceAdminService
 *
 * Manages invoice retrieval and synchronization for billing customers.
 * Provides access to invoice history, upcoming invoices, and maintains sync with Stripe.
 *
 * Key Features:
 * - List customer invoices with filtering by status
 * - Retrieve individual invoices
 * - Preview upcoming invoices for subscriptions
 * - Sync invoice data from Stripe webhooks
 * - Support for Stripe v20 API invoice structure
 *
 * Invoices are automatically created and synced via webhooks when Stripe generates them
 * for subscriptions or one-time charges.
 */
@Injectable()
export class StripeInvoiceAdminService {
  private readonly logger = new Logger(StripeInvoiceAdminService.name);

  constructor(
    private readonly stripeInvoiceRepository: StripeInvoiceRepository,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly subscriptionRepository: StripeSubscriptionRepository,
    private readonly stripeInvoiceApiService: StripeInvoiceApiService,
    private readonly jsonApiService: JsonApiService,
  ) {}

  /**
   * List invoices for a company
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.query - JSON:API query parameters for pagination
   * @param params.status - Optional filter by invoice status
   * @returns JSON:API formatted list of invoices
   * @throws {HttpException} NOT_FOUND if billing customer not found
   *
   * @example
   * ```typescript
   * const invoices = await stripeInvoiceAdminService.listInvoices({
   *   companyId: 'company_123',
   *   query: { page: { number: 1, size: 10 } },
   *   status: 'paid'
   * });
   * ```
   */
  async listInvoices(params: {
    companyId: string;
    query: any;
    status?: StripeInvoiceStatus;
  }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(params.query);

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND);
    }

    const invoices = await this.stripeInvoiceRepository.findByStripeCustomerId({
      stripeCustomerId: customer.id,
      status: params.status,
      cursor: paginator.generateCursor(),
    });

    return this.jsonApiService.buildList(StripeInvoiceModel, invoices, paginator);
  }

  /**
   * Get a single invoice by ID
   *
   * @param params - Parameters
   * @param params.id - Invoice ID
   * @param params.companyId - Company identifier
   * @returns JSON:API formatted invoice data
   * @throws {HttpException} NOT_FOUND if invoice not found
   * @throws {HttpException} FORBIDDEN if invoice doesn't belong to company
   */
  async getInvoice(params: { id: string; companyId: string }): Promise<JsonApiSingleDocument> {
    const invoice = await this.stripeInvoiceRepository.findById({ id: params.id });

    if (!invoice) {
      throw new HttpException("Invoice not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || invoice.stripeCustomer?.id !== customer.id) {
      throw new HttpException("Invoice does not belong to this company", HttpStatus.FORBIDDEN);
    }

    return this.jsonApiService.buildSingle(StripeInvoiceModel, invoice);
  }

  /**
   * Preview the upcoming invoice for a customer
   *
   * Retrieves the next invoice that will be charged for a customer or specific subscription.
   * This is useful for showing customers what they will be charged before the invoice is finalized.
   *
   * @param params - Parameters
   * @param params.companyId - Company identifier
   * @param params.subscriptionId - Optional subscription ID to preview
   * @returns Upcoming invoice preview with amounts and line items
   * @throws {HttpException} NOT_FOUND if billing customer or subscription not found
   *
   * @example
   * ```typescript
   * const upcoming = await stripeInvoiceAdminService.getUpcomingInvoice({
   *   companyId: 'company_123',
   *   subscriptionId: 'sub_456'
   * });
   * console.info(`Next charge: ${upcoming.amountDue}`);
   * ```
   */
  async getUpcomingInvoice(params: { companyId: string; subscriptionId?: string }): Promise<any> {
    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND);
    }

    let subscriptionStripeId: string | undefined;

    if (params.subscriptionId) {
      const subscription = await this.subscriptionRepository.findById({ id: params.subscriptionId });
      if (!subscription || subscription.stripeCustomer?.id !== customer.id) {
        throw new HttpException("Subscription not found or does not belong to this company", HttpStatus.NOT_FOUND);
      }
      subscriptionStripeId = subscription.stripeSubscriptionId;
    }

    const upcomingInvoice: Stripe.Invoice = await this.stripeInvoiceApiService.getUpcomingInvoice({
      customerId: customer.stripeCustomerId,
      subscriptionId: subscriptionStripeId,
    });

    return {
      subtotal: upcomingInvoice.subtotal,
      total: upcomingInvoice.total,
      amountDue: upcomingInvoice.amount_due,
      currency: upcomingInvoice.currency,
      periodStart: upcomingInvoice.period_start ? new Date(upcomingInvoice.period_start * 1000).toISOString() : null,
      periodEnd: upcomingInvoice.period_end ? new Date(upcomingInvoice.period_end * 1000).toISOString() : null,
      lines: upcomingInvoice.lines.data.map((line: Stripe.InvoiceLineItem) => ({
        id: line.id,
        description: line.description,
        amount: line.amount,
        currency: line.currency,
        quantity: line.quantity,
        periodStart: new Date(line.period.start * 1000).toISOString(),
        periodEnd: new Date(line.period.end * 1000).toISOString(),
      })),
    };
  }

  /**
   * Sync invoice data from Stripe to local database
   *
   * Fetches the latest invoice data from Stripe and updates or creates the local database record.
   * Handles Stripe v20 API structure including parent subscription details and tax calculations.
   * Used primarily by webhook handlers to keep invoice data in sync.
   *
   * @param params - Parameters
   * @param params.stripeInvoiceId - Stripe invoice ID to sync
   * @returns Promise that resolves when sync is complete
   *
   * @example
   * ```typescript
   * // Called from webhook handler
   * await stripeInvoiceAdminService.syncInvoiceFromStripe({
   *   stripeInvoiceId: 'in_1234567890'
   * });
   * ```
   */
  async syncInvoiceFromStripe(params: { stripeInvoiceId: string }): Promise<void> {
    const stripeInvoice: Stripe.Invoice = await this.stripeInvoiceApiService.getInvoice(params.stripeInvoiceId);

    const stripeCustomerId =
      typeof stripeInvoice.customer === "string" ? stripeInvoice.customer : stripeInvoice.customer?.id;
    if (!stripeCustomerId) {
      return;
    }

    const customer = await this.stripeCustomerRepository.findByStripeCustomerId({ stripeCustomerId });
    if (!customer) {
      return;
    }

    const existingInvoice = await this.stripeInvoiceRepository.findByStripeInvoiceId({
      stripeInvoiceId: stripeInvoice.id,
    });

    // Get subscription ID from the parent.subscription_details in Stripe v20
    let subscriptionId: string | undefined;
    const subscriptionDetails = stripeInvoice.parent?.subscription_details;
    if (subscriptionDetails?.subscription) {
      const stripeSubscriptionId =
        typeof subscriptionDetails.subscription === "string"
          ? subscriptionDetails.subscription
          : subscriptionDetails.subscription.id;
      const subscription = await this.subscriptionRepository.findByStripeSubscriptionId({
        stripeSubscriptionId,
      });
      subscriptionId = subscription?.id;
    }

    if (existingInvoice) {
      await this.stripeInvoiceRepository.updateByStripeInvoiceId({
        stripeInvoiceId: stripeInvoice.id,
        status: stripeInvoice.status as StripeInvoiceStatus,
        amountDue: stripeInvoice.amount_due,
        amountPaid: stripeInvoice.amount_paid,
        amountRemaining: stripeInvoice.amount_remaining,
        paidAt: stripeInvoice.status_transitions?.paid_at
          ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
          : null,
        attemptCount: stripeInvoice.attempt_count ?? 0,
        attempted: stripeInvoice.attempted ?? false,
        stripeHostedInvoiceUrl: stripeInvoice.hosted_invoice_url ?? undefined,
        stripePdfUrl: stripeInvoice.invoice_pdf ?? undefined,
      });
      await this.recordServiceLinesFromStripe(stripeInvoice);
    } else {
      // In Stripe v20, tax is calculated as total - total_excluding_tax
      const tax =
        stripeInvoice.total_excluding_tax !== null
          ? stripeInvoice.total - (stripeInvoice.total_excluding_tax ?? 0)
          : null;

      await this.stripeInvoiceRepository.create({
        stripeCustomerId: customer.id,
        subscriptionId,
        stripeInvoiceId: stripeInvoice.id,
        stripeInvoiceNumber: stripeInvoice.number,
        stripeHostedInvoiceUrl: stripeInvoice.hosted_invoice_url,
        stripePdfUrl: stripeInvoice.invoice_pdf,
        status: stripeInvoice.status as StripeInvoiceStatus,
        currency: stripeInvoice.currency,
        amountDue: stripeInvoice.amount_due,
        amountPaid: stripeInvoice.amount_paid,
        amountRemaining: stripeInvoice.amount_remaining,
        subtotal: stripeInvoice.subtotal,
        total: stripeInvoice.total,
        tax,
        periodStart: new Date(stripeInvoice.period_start * 1000),
        periodEnd: new Date(stripeInvoice.period_end * 1000),
        dueDate: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000) : null,
        paidAt: stripeInvoice.status_transitions?.paid_at
          ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
          : null,
        attemptCount: stripeInvoice.attempt_count ?? 0,
        attempted: stripeInvoice.attempted ?? false,
      });
      await this.recordServiceLinesFromStripe(stripeInvoice);
    }
  }

  /**
   * Records what a Stripe invoice was for on its local node (WYR-98): the covered period and price
   * of its first non-proration line, and, for a one-time purchase (no subscription parent), the
   * `pi_` StripeSubscription record of the PaymentIntent that paid it.
   *
   * When the line's price is not stored locally yet, the period is written without the price edge
   * and the invoice is left unchecked, so the backfill retries it on the next worker boot.
   *
   * @param stripeInvoice - the invoice as Stripe returns it, lines and payments expanded
   * @returns "recorded", or "price-unknown" when the line's price is not stored locally
   */
  async recordServiceLinesFromStripe(stripeInvoice: Stripe.Invoice): Promise<"recorded" | "price-unknown"> {
    const lines = readServiceLines(stripeInvoice);

    const priceKnown =
      !lines.stripePriceId || (await this.stripeInvoiceRepository.priceExists({ stripePriceId: lines.stripePriceId }));

    const purchase =
      !stripeInvoice.parent?.subscription_details?.subscription && lines.paymentIntentId
        ? await this.subscriptionRepository.findByStripeSubscriptionId({ stripeSubscriptionId: lines.paymentIntentId })
        : null;

    await this.stripeInvoiceRepository.recordServiceLines({
      stripeInvoiceId: stripeInvoice.id,
      servicePeriodStart: lines.periodStart,
      servicePeriodEnd: lines.periodEnd,
      stripePriceId: priceKnown ? lines.stripePriceId : undefined,
      purchaseSubscriptionId: purchase?.id,
      markChecked: priceKnown,
    });

    if (!priceKnown) {
      this.logger.warn(
        `Invoice ${stripeInvoice.id}: price ${lines.stripePriceId} is not stored locally; service lines left unchecked`,
      );
      return "price-unknown";
    }

    return "recorded";
  }

  /**
   * Every non-draft invoice of a company, for the platform administrator (WYR-98). A company
   * without a Stripe customer gets an empty list, never a 404.
   *
   * @param params.companyId - the company id from the URL
   * @param params.query - JSON:API query parameters
   * @returns JSON:API list of invoices with their price, product and forSubscription
   */
  async listForCompanyAdmin(params: { companyId: string; query: any }): Promise<JsonApiListDocument> {
    const paginator = new JsonApiPaginator(params.query);

    const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      return this.jsonApiService.buildList(StripeInvoiceModel, [], paginator);
    }

    const invoices = await this.stripeInvoiceRepository.findForCompanyAdmin({ companyId: params.companyId });

    return this.jsonApiService.buildList(StripeInvoiceModel, invoices, paginator);
  }
}
