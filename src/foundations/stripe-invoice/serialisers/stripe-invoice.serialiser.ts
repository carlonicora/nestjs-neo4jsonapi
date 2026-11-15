import { StripeInvoiceDescriptor } from "../entities/stripe-invoice";

/** The StripeInvoice serialiser class, kept as an alias of the descriptor's generated serialiser. */
export const StripeInvoiceSerialiser = StripeInvoiceDescriptor.model.serialiser;
