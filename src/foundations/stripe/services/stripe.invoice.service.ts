import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

/**
 * Stripe Invoice Service
 *
 * Manages Stripe invoices including retrieval, listing, and payment operations.
 * Provides access to upcoming invoices for subscription previews.
 *
 * @example
 * ```typescript
 * const invoice = await stripeInvoiceService.retrieveInvoice('in_abc123');
 *
 * const invoices = await stripeInvoiceService.listInvoices({
 *   stripeCustomerId: 'cus_abc123',
 *   status: 'paid',
 * });
 * ```
 */
@Injectable()
export class StripeInvoiceService {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Retrieve an invoice by ID
   *
   * @param invoiceId - The Stripe invoice ID
   * @returns Promise resolving to the invoice
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const invoice = await service.retrieveInvoice('in_abc123');
   * ```
   */
  @HandleStripeErrors()
  async retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = this.stripeService.getClient();
    return stripe.invoices.retrieve(invoiceId);
  }

  /**
   * List invoices for a customer
   *
   * @param params - Listing parameters
   * @param params.stripeCustomerId - Stripe customer ID
   * @param params.status - Filter by invoice status (optional)
   * @param params.limit - Maximum number of invoices to return (optional, default: 100)
   * @returns Promise resolving to array of invoices
   * @throws {StripeError} If listing fails
   *
   * @example
   * ```typescript
   * // List all invoices
   * const invoices = await service.listInvoices({
   *   stripeCustomerId: 'cus_abc123',
   * });
   *
   * // List only paid invoices
   * const paidInvoices = await service.listInvoices({
   *   stripeCustomerId: 'cus_abc123',
   *   status: 'paid',
   * });
   * ```
   */
  @HandleStripeErrors()
  async listInvoices(params: {
    stripeCustomerId: string;
    status?: Stripe.InvoiceListParams.Status;
    limit?: number;
  }): Promise<Stripe.Invoice[]> {
    const stripe = this.stripeService.getClient();
    const listParams: Stripe.InvoiceListParams = {
      customer: params.stripeCustomerId,
      limit: params.limit || 100,
    };
    if (params.status) {
      listParams.status = params.status;
    }
    const invoices = await stripe.invoices.list(listParams);
    return invoices.data;
  }

  /**
   * Get an invoice with expanded line items
   *
   * @param invoiceId - The Stripe invoice ID
   * @returns Promise resolving to the invoice with expanded lines
   * @throws {StripeError} If retrieval fails
   *
   * @example
   * ```typescript
   * const invoice = await service.getInvoice('in_abc123');
   * console.log(invoice.lines.data);
   * ```
   */
  @HandleStripeErrors()
  async getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = this.stripeService.getClient();
    return stripe.invoices.retrieve(invoiceId, {
      expand: ["lines.data"],
    });
  }

  /**
   * Get the upcoming invoice for a customer or subscription
   *
   * @param params - Preview parameters
   * @param params.customerId - Stripe customer ID
   * @param params.subscriptionId - Stripe subscription ID (optional)
   * @returns Promise resolving to the upcoming invoice preview
   * @throws {StripeError} If preview fails
   *
   * @example
   * ```typescript
   * // Preview next invoice for customer
   * const upcoming = await service.getUpcomingInvoice({
   *   customerId: 'cus_abc123',
   * });
   *
   * // Preview next invoice for specific subscription
   * const upcomingSub = await service.getUpcomingInvoice({
   *   customerId: 'cus_abc123',
   *   subscriptionId: 'sub_xyz789',
   * });
   * ```
   */
  @HandleStripeErrors()
  async getUpcomingInvoice(params: { customerId: string; subscriptionId?: string }): Promise<Stripe.UpcomingInvoice> {
    const stripe = this.stripeService.getClient();
    const previewParams: Stripe.InvoiceCreatePreviewParams = {
      customer: params.customerId,
    };
    if (params.subscriptionId) {
      previewParams.subscription = params.subscriptionId;
    }
    return stripe.invoices.createPreview(previewParams);
  }

  /**
   * Pay an invoice
   *
   * @param invoiceId - The invoice ID to pay
   * @returns Promise resolving to the paid invoice
   * @throws {StripeError} If payment fails
   *
   * @example
   * ```typescript
   * const invoice = await service.payInvoice('in_abc123');
   * ```
   */
  @HandleStripeErrors()
  async payInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = this.stripeService.getClient();
    return stripe.invoices.pay(invoiceId);
  }

  /**
   * Void an invoice
   *
   * @param invoiceId - The invoice ID to void
   * @returns Promise resolving to the voided invoice
   * @throws {StripeError} If voiding fails
   *
   * @example
   * ```typescript
   * const invoice = await service.voidInvoice('in_abc123');
   * ```
   *
   * @remarks
   * Only draft or open invoices can be voided.
   */
  @HandleStripeErrors()
  async voidInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = this.stripeService.getClient();
    return stripe.invoices.voidInvoice(invoiceId);
  }
}
