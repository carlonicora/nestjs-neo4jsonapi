import { DataModelInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { billingCustomerMeta } from "../../stripe/entities/billing-customer.meta";
import { StripeInvoice } from "./stripe-invoice.entity";
import { mapStripeInvoice } from "./stripe-invoice.map";
import { stripeInvoiceMeta } from "./stripe-invoice.meta";
import { stripeSubscriptionMeta } from "../../stripe-subscription/entities/stripe-subscription.meta";
import { StripeInvoiceSerialiser } from "../serialisers/stripe-invoice.serialiser";

export const StripeInvoiceModel: DataModelInterface<StripeInvoice> = {
  ...stripeInvoiceMeta,
  entity: undefined as unknown as StripeInvoice,
  mapper: mapStripeInvoice,
  serialiser: StripeInvoiceSerialiser,
  singleChildrenTokens: [billingCustomerMeta.nodeName, stripeSubscriptionMeta.nodeName],
  childrenTokens: [],
};
