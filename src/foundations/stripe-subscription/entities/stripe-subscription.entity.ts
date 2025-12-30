import { Entity } from "../../../common/abstracts/entity";
import { BillingCustomer } from "../../stripe/entities/billing-customer.entity";
import { StripePrice } from "../../stripe-price/entities/stripe-price.entity";

export type StripeSubscriptionStatus =
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "paused";

export type StripeSubscription = Entity & {
  stripeSubscriptionId: string;
  stripeSubscriptionItemId?: string;

  status: StripeSubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;

  trialStart?: Date;
  trialEnd?: Date;
  pausedAt?: Date;

  quantity: number;

  billingCustomer: BillingCustomer;
  price: StripePrice;
};
