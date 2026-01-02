import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { stripeCustomerMeta } from "../../stripe-customer/entities/stripe-customer.meta";
import { stripeSubscriptionMeta } from "../../stripe-subscription/entities/stripe-subscription.meta";
import { StripeInvoiceSerialiser } from "../serialisers/stripe-invoice.serialiser";
import { StripeInvoice } from "./stripe-invoice.entity";
import { mapStripeInvoice } from "./stripe-invoice.map";
import { stripeInvoiceMeta } from "./stripe-invoice.meta";

export const StripeInvoiceModel: DataModelInterface<StripeInvoice> = {
  ...stripeInvoiceMeta,
  entity: undefined as unknown as StripeInvoice,
  mapper: mapStripeInvoice,
  serialiser: StripeInvoiceSerialiser,
  singleChildrenTokens: [stripeCustomerMeta.nodeName, stripeSubscriptionMeta.nodeName],
  childrenTokens: [],
};
