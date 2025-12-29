import { Entity } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeProduct } from "../entities/stripe-product.entity";

export type StripePriceType = "one_time" | "recurring";
export type StripePriceRecurringInterval = "day" | "week" | "month" | "year";
export type StripePriceRecurringUsageType = "licensed" | "metered";

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

  product: StripeProduct;
};
