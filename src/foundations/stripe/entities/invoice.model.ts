import { DataModelInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { billingCustomerMeta } from "../entities/billing-customer.meta";
import { Invoice } from "../entities/invoice.entity";
import { mapInvoice } from "../entities/invoice.map";
import { invoiceMeta } from "../entities/invoice.meta";
import { subscriptionMeta } from "../entities/subscription.meta";
import { InvoiceSerialiser } from "../serialisers/invoice.serialiser";

export const InvoiceModel: DataModelInterface<Invoice> = {
  ...invoiceMeta,
  entity: undefined as unknown as Invoice,
  mapper: mapInvoice,
  serialiser: InvoiceSerialiser,
  singleChildrenTokens: [billingCustomerMeta.nodeName, subscriptionMeta.nodeName],
  childrenTokens: [],
};
