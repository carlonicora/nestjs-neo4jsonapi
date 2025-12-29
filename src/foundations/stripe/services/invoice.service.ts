import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { JsonApiDataInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiPaginator } from "@carlonicora/nestjs-neo4jsonapi";
import { JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeInvoiceService } from "@carlonicora/nestjs-neo4jsonapi";
import { BillingCustomerRepository } from "../repositories/billing-customer.repository";
import { InvoiceRepository } from "../repositories/invoice.repository";
import { SubscriptionRepository } from "../repositories/subscription.repository";
import { InvoiceModel } from "../entities/invoice.model";
import { InvoiceStatus } from "../entities/invoice.entity";

/**
 * InvoiceService
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
export class InvoiceService {
  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly billingCustomerRepository: BillingCustomerRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly stripeInvoiceService: StripeInvoiceService,
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
   * const invoices = await invoiceService.listInvoices({
   *   companyId: 'company_123',
   *   query: { page: { number: 1, size: 10 } },
   *   status: 'paid'
   * });
   * ```
   */
  async listInvoices(params: { companyId: string; query: any; status?: InvoiceStatus }): Promise<JsonApiDataInterface> {
    const paginator = new JsonApiPaginator(params.query);

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND);
    }

    const invoices = await this.invoiceRepository.findByBillingCustomerId({
      billingCustomerId: customer.id,
      status: params.status,
    });

    return this.jsonApiService.buildList(InvoiceModel, invoices, paginator);
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
  async getInvoice(params: { id: string; companyId: string }): Promise<JsonApiDataInterface> {
    const invoice = await this.invoiceRepository.findById({ id: params.id });

    if (!invoice) {
      throw new HttpException("Invoice not found", HttpStatus.NOT_FOUND);
    }

    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer || invoice.billingCustomer?.id !== customer.id) {
      throw new HttpException("Invoice does not belong to this company", HttpStatus.FORBIDDEN);
    }

    return this.jsonApiService.buildSingle(InvoiceModel, invoice);
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
   * const upcoming = await invoiceService.getUpcomingInvoice({
   *   companyId: 'company_123',
   *   subscriptionId: 'sub_456'
   * });
   * console.log(`Next charge: ${upcoming.amountDue}`);
   * ```
   */
  async getUpcomingInvoice(params: { companyId: string; subscriptionId?: string }): Promise<any> {
    const customer = await this.billingCustomerRepository.findByCompanyId({ companyId: params.companyId });
    if (!customer) {
      throw new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND);
    }

    let subscriptionStripeId: string | undefined;

    if (params.subscriptionId) {
      const subscription = await this.subscriptionRepository.findById({ id: params.subscriptionId });
      if (!subscription || subscription.billingCustomer?.id !== customer.id) {
        throw new HttpException("Subscription not found or does not belong to this company", HttpStatus.NOT_FOUND);
      }
      subscriptionStripeId = subscription.stripeSubscriptionId;
    }

    const upcomingInvoice: Stripe.UpcomingInvoice = await this.stripeInvoiceService.getUpcomingInvoice({
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
   * await invoiceService.syncInvoiceFromStripe({
   *   stripeInvoiceId: 'in_1234567890'
   * });
   * ```
   */
  async syncInvoiceFromStripe(params: { stripeInvoiceId: string }): Promise<void> {
    const stripeInvoice: Stripe.Invoice = await this.stripeInvoiceService.getInvoice(params.stripeInvoiceId);

    const stripeCustomerId =
      typeof stripeInvoice.customer === "string" ? stripeInvoice.customer : stripeInvoice.customer?.id;
    if (!stripeCustomerId) {
      return;
    }

    const customer = await this.billingCustomerRepository.findByStripeCustomerId({ stripeCustomerId });
    if (!customer) {
      return;
    }

    const existingInvoice = await this.invoiceRepository.findByStripeInvoiceId({
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
      await this.invoiceRepository.updateByStripeInvoiceId({
        stripeInvoiceId: stripeInvoice.id,
        status: stripeInvoice.status as InvoiceStatus,
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
    } else {
      // In Stripe v20, tax is calculated as total - total_excluding_tax
      const tax =
        stripeInvoice.total_excluding_tax !== null
          ? stripeInvoice.total - (stripeInvoice.total_excluding_tax ?? 0)
          : null;

      await this.invoiceRepository.create({
        billingCustomerId: customer.id,
        subscriptionId,
        stripeInvoiceId: stripeInvoice.id,
        stripeInvoiceNumber: stripeInvoice.number,
        stripeHostedInvoiceUrl: stripeInvoice.hosted_invoice_url,
        stripePdfUrl: stripeInvoice.invoice_pdf,
        status: stripeInvoice.status as InvoiceStatus,
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
    }
  }
}
