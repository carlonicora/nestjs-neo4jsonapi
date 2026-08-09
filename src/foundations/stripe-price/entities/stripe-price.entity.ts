import { Entity } from "../../../common/abstracts/entity";
import { StripeProduct } from "../../stripe-product/entities/stripe-product.entity";
import type { Feature } from "../../feature/entities/feature";

export type StripePriceType = "one_time" | "recurring";
export type StripePriceRecurringInterval = "day" | "week" | "month" | "year";
export type StripePriceRecurringUsageType = "licensed" | "metered";

const STRIPE_PRICE_RECURRING_INTERVALS: readonly StripePriceRecurringInterval[] = ["day", "week", "month", "year"];

/**
 * Narrow a Stripe recurring interval to the intervals this system stores.
 *
 * stripe@22 widens response enums with `OtherString`, so a value the Stripe API adds in
 * future still typechecks as `Price.Recurring.Interval`. Anything outside the known set is
 * reported as absent rather than persisted as a value the domain type claims is impossible.
 */
export function toStripePriceRecurringInterval(value: string | undefined): StripePriceRecurringInterval | undefined {
  return STRIPE_PRICE_RECURRING_INTERVALS.find((interval) => interval === value);
}

export type StripePrice = Entity & {
  stripePriceId: string;
  active: boolean;
  currency: string;
  unitAmount?: number;

  priceType: StripePriceType;
  recurringInterval?: StripePriceRecurringInterval;
  recurringIntervalCount?: number;
  recurringUsageType?: StripePriceRecurringUsageType;

  nickname?: string;
  lookupKey?: string;
  metadata?: string;
  description?: string;
  features?: string; // JSON array stored as string
  token?: number; // Neo4j only, not synced to Stripe
  isTrial?: boolean; // Marks this price as the trial subscription plan (Neo4j only)

  stripeProduct: StripeProduct;
  feature?: Feature[]; // HAS_FEATURE relationship (naming follows Company pattern)
};
