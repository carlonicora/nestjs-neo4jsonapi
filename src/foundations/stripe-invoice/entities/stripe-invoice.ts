import { defineEntity } from "../../../common/helpers/define-entity";
import { stripeCustomerMeta } from "../../stripe-customer/entities/stripe-customer.meta";
import { stripePriceMeta } from "../../stripe-price/entities/stripe-price.meta";
import { stripeSubscriptionMeta } from "../../stripe-subscription/entities/stripe-subscription.meta";
import type { StripeInvoice } from "./stripe-invoice.entity";
import { stripeInvoiceMeta } from "./stripe-invoice.meta";

/**
 * StripeInvoice descriptor.
 *
 * An invoice reaches its company through its Stripe customer
 * (`(stripeInvoice)-[:BELONGS_TO]->(stripeCustomer)-[:BELONGS_TO]->(company)`), so request-time
 * reads are scoped to the caller's company through `tenancy: { via: "stripeCustomer" }`. Worker
 * callers (webhooks, notifications) carry no company and read every invoice.
 *
 * Machine strings (Stripe ids, URLs, enum values, currency codes) are excluded from search: no
 * fulltext index.
 */
export const StripeInvoiceDescriptor = defineEntity<StripeInvoice>()({
  ...stripeInvoiceMeta,
  isCompanyScoped: false,
  tenancy: { via: "stripeCustomer" },

  fields: {
    stripeInvoiceId: { type: "string", required: true, excludeFromSearch: true },
    stripeInvoiceNumber: { type: "string", excludeFromSearch: true },
    stripeHostedInvoiceUrl: { type: "string", excludeFromSearch: true },
    stripePdfUrl: { type: "string", excludeFromSearch: true },
    status: { type: "string", required: true, excludeFromSearch: true },
    currency: { type: "string", required: true, excludeFromSearch: true },
    amountDue: { type: "number" },
    amountPaid: { type: "number" },
    amountRemaining: { type: "number" },
    subtotal: { type: "number" },
    total: { type: "number" },
    tax: { type: "number" },
    periodStart: { type: "datetime", required: true },
    periodEnd: { type: "datetime", required: true },
    dueDate: { type: "datetime" },
    paidAt: { type: "datetime" },
    attemptCount: { type: "number" },
    attempted: { type: "boolean" },
    // The covered period of the invoice's first non-proration line.
    servicePeriodStart: { type: "datetime" },
    servicePeriodEnd: { type: "datetime" },
    // Marker of the service lines read (live sync and backfill); internal.
    serviceLinesCheckedAt: { type: "datetime", excludeFromJsonApi: true },
  },

  virtualFields: {
    // Filled only by the admin company invoices query, which returns the column.
    forSubscription: {
      compute: (p) => (p.record?.has?.("forSubscription") ? p.record.get("forSubscription") === true : undefined),
    },
  },

  // Every edge leaves the invoice, as stored.
  relationships: {
    stripeCustomer: {
      model: stripeCustomerMeta,
      direction: "out",
      relationship: "BELONGS_TO",
      cardinality: "one",
      required: true,
      dtoKey: "stripeCustomer",
    },
    subscription: {
      model: stripeSubscriptionMeta,
      direction: "out",
      relationship: "FOR_SUBSCRIPTION",
      cardinality: "one",
      required: false,
      dtoKey: "subscription",
    },
    stripePrice: {
      model: stripePriceMeta,
      direction: "out",
      relationship: "FOR_PRICE",
      cardinality: "one",
      required: false,
      dtoKey: "stripePrice",
    },
  },
});

export type StripeInvoiceDescriptorType = typeof StripeInvoiceDescriptor;
