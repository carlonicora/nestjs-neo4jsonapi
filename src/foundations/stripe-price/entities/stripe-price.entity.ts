import { Entity } from "../../../common/abstracts/entity";
import { StripeProduct } from "../../stripe-product/entities/stripe-product.entity";

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
  description?: string;
  features?: string; // JSON array stored as string
  token?: number; // Neo4j only, not synced to Stripe

  stripeProduct: StripeProduct;
};
