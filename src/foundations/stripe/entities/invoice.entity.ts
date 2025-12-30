import { Entity } from "../../../common/abstracts/entity";
import { BillingCustomer } from "../entities/billing-customer.entity";
import { StripeSubscription } from "../../stripe-subscription/entities/stripe-subscription.entity";

export type InvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

export type Invoice = Entity & {
  stripeInvoiceId: string;
  stripeInvoiceNumber: string | null;
  stripeHostedInvoiceUrl: string | null;
  stripePdfUrl: string | null;

  status: InvoiceStatus;
  currency: string;
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  subtotal: number;
  total: number;
  tax: number | null;

  periodStart: Date;
  periodEnd: Date;
  dueDate: Date | null;
  paidAt: Date | null;
  attemptCount: number;
  attempted: boolean;

  billingCustomer?: BillingCustomer;
  subscription?: StripeSubscription;
};
