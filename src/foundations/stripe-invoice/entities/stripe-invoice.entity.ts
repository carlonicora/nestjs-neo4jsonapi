import { Entity } from "../../../common/abstracts/entity";
import { StripeCustomer } from "../../stripe-customer/entities/stripe-customer.entity";
import { StripePrice } from "../../stripe-price/entities/stripe-price.entity";
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

  // What the invoice was for, from its first line that is not a proration (WYR-98).
  servicePeriodStart?: Date;
  servicePeriodEnd?: Date;
  /** When the service lines were last read from Stripe; internal, never serialised. */
  serviceLinesCheckedAt?: Date;
  /** Whether the invoice has a FOR_SUBSCRIPTION edge; set only by the admin company invoices query. */
  forSubscription?: boolean;

  stripeCustomer?: StripeCustomer;
  subscription?: StripeSubscription;
  stripePrice?: StripePrice;
};
