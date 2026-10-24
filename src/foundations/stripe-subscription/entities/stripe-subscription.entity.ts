import { Entity } from "../../../common/abstracts/entity";
import { StripeCustomer } from "../../stripe-customer/entities/stripe-customer.entity";
import { StripePrice } from "../../stripe-price/entities/stripe-price.entity";

export type StripeSubscriptionStatus =
  "active" | "past_due" | "unpaid" | "canceled" | "incomplete" | "incomplete_expired" | "trialing" | "paused";

export type StripeSubscriptionDiscountDuration = "forever" | "once" | "repeating";

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

  // The discount Stripe applies to the subscription (first subscription-level discount),
  // copied from its coupon on every write from Stripe. Absent when there is none.
  discountPercentOff?: number;
  discountAmountOff?: number; // minor units, in discountCurrency
  discountCurrency?: string;
  discountDuration?: StripeSubscriptionDiscountDuration;
  discountDurationInMonths?: number;
  discountEnd?: Date; // when a repeating discount stops; absent for once/forever

  stripeCustomer: StripeCustomer;
  stripePrice: StripePrice;
};
