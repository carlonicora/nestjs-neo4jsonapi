import { Injectable } from "@nestjs/common";
import Stripe from "stripe";
import { StripeService } from "./stripe.service";
import { HandleStripeErrors } from "../errors/stripe.errors";

@Injectable()
export class StripeInvoiceService {
  constructor(private readonly stripeService: StripeService) {}

  @HandleStripeErrors()
  async retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = this.stripeService.getClient();
    return stripe.invoices.retrieve(invoiceId);
  }

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

  @HandleStripeErrors()
  async getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = this.stripeService.getClient();
    return stripe.invoices.retrieve(invoiceId, {
      expand: ["lines.data"],
    });
  }

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

  @HandleStripeErrors()
  async payInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = this.stripeService.getClient();
    return stripe.invoices.pay(invoiceId);
  }

  @HandleStripeErrors()
  async voidInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = this.stripeService.getClient();
    return stripe.invoices.voidInvoice(invoiceId);
  }
}
