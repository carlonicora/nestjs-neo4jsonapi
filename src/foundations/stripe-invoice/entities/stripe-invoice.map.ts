import { StripeInvoiceDescriptor } from "./stripe-invoice";

/** The StripeInvoice mapper, kept as an alias of the descriptor's generated mapper. */
export const mapStripeInvoice = StripeInvoiceDescriptor.model.mapper;
