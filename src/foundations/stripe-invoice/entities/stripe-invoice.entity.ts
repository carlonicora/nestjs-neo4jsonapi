import { Entity } from "../../../common/abstracts/entity";
import { StripeCustomer } from "../../stripe-customer/entities/stripe-customer.entity";
import { StripeSubscription } from "../../stripe-subscription/entities/stripe-subscription";

export type StripeInvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

export type StripeInvoice = Entity & {
  stripeInvoiceId: string;
  stripeInvoiceNumber: string | null;
  stripeHostedInvoiceUrl: string | null;
  stripePdfUrl: string | null;

  status: StripeInvoiceStatus;
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

  stripeCustomer?: StripeCustomer;
  subscription?: StripeSubscription;
};
