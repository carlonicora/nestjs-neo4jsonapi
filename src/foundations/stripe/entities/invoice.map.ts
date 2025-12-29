import { mapEntity } from "@carlonicora/nestjs-neo4jsonapi";
import { EntityFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { Invoice } from "../entities/invoice.entity";

export const mapInvoice = (params: { data: any; record: any; entityFactory: EntityFactory }): Invoice => {
  return {
    ...mapEntity({ record: params.data }),
    stripeInvoiceId: params.data.stripeInvoiceId,
    stripeInvoiceNumber: params.data.stripeInvoiceNumber || null,
    stripeHostedInvoiceUrl: params.data.stripeHostedInvoiceUrl || null,
    stripePdfUrl: params.data.stripePdfUrl || null,
    status: params.data.status,
    currency: params.data.currency,
    amountDue: Number(params.data.amountDue ?? 0),
    amountPaid: Number(params.data.amountPaid ?? 0),
    amountRemaining: Number(params.data.amountRemaining ?? 0),
    subtotal: Number(params.data.subtotal ?? 0),
    total: Number(params.data.total ?? 0),
    tax: params.data.tax !== null ? Number(params.data.tax) : null,
    periodStart: params.data.periodStart ? new Date(params.data.periodStart) : new Date(),
    periodEnd: params.data.periodEnd ? new Date(params.data.periodEnd) : new Date(),
    dueDate: params.data.dueDate ? new Date(params.data.dueDate) : null,
    paidAt: params.data.paidAt ? new Date(params.data.paidAt) : null,
    attemptCount: Number(params.data.attemptCount ?? 0),
    attempted: params.data.attempted === true,
    billingCustomer: undefined,
    subscription: undefined,
  };
};
