import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { StripeInvoiceDescriptor } from "./stripe-invoice";
import { StripeInvoice } from "./stripe-invoice.entity";

/** The StripeInvoice model, kept as an alias of the descriptor's model. */
export const StripeInvoiceModel: DataModelInterface<StripeInvoice> = StripeInvoiceDescriptor.model;
