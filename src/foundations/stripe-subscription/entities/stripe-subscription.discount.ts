import Stripe from "stripe";
import { StripeSubscriptionDiscountDuration } from "./stripe-subscription.entity";

/**
 * The discount a subscription carries, as written to the StripeSubscription node.
 * Every field is null when the coupon does not set it, so a write clears what an
 * earlier discount left behind.
 */
export type StripeSubscriptionDiscount = {
  percentOff: number | null;
  amountOff: number | null; // minor units
  currency: string | null;
  duration: StripeSubscriptionDiscountDuration;
  durationInMonths: number | null;
  end: Date | null;
};

/**
 * The Stripe `expand` path that makes `subscription.discounts` readable by
 * {@link discountFromStripeSubscription}. Without it Stripe returns discount ids only.
 */
export const STRIPE_SUBSCRIPTION_DISCOUNT_EXPAND = "discounts.source.coupon";

/**
 * Reads the discount of a Stripe subscription (its first subscription-level discount).
 *
 * - `null`: Stripe says the subscription has no discount; the stored one must be cleared.
 * - `undefined`: the discount cannot be read (ids not expanded); leave the stored one as it is.
 */
export function discountFromStripeSubscription(
  subscription: Pick<Stripe.Subscription, "discounts">,
): StripeSubscriptionDiscount | null | undefined {
  const discounts = subscription.discounts;
  if (!Array.isArray(discounts)) return undefined;
  if (discounts.length === 0) return null;

  const discount = discounts[0];
  if (typeof discount === "string") return undefined;

  // API versions before 2025-09-30 put the coupon on the discount itself.
  const coupon = discount.source?.coupon ?? (discount as unknown as { coupon?: Stripe.Coupon | string }).coupon;
  if (!coupon || typeof coupon === "string") return undefined;
  // Stripe's type leaves room for durations added later; one we do not know cannot be stored
  if (!isKnownDuration(coupon.duration)) return undefined;

  return {
    percentOff: coupon.percent_off ?? null,
    amountOff: coupon.amount_off ?? null,
    currency: coupon.currency ?? null,
    duration: coupon.duration,
    durationInMonths: coupon.duration_in_months ?? null,
    end: discount.end ? new Date(discount.end * 1000) : null,
  };
}

const KNOWN_DURATIONS: readonly StripeSubscriptionDiscountDuration[] = ["forever", "once", "repeating"];

function isKnownDuration(duration: string): duration is StripeSubscriptionDiscountDuration {
  return (KNOWN_DURATIONS as readonly string[]).includes(duration);
}

/** Query parameters for the discount fields; all null when there is no discount. */
export function discountQueryParams(discount: StripeSubscriptionDiscount | null): Record<string, unknown> {
  return {
    discountPercentOff: discount?.percentOff ?? null,
    discountAmountOff: discount?.amountOff ?? null,
    discountCurrency: discount?.currency ?? null,
    discountDuration: discount?.duration ?? null,
    discountDurationInMonths: discount?.durationInMonths ?? null,
    discountEnd: discount?.end?.toISOString() ?? null,
  };
}
