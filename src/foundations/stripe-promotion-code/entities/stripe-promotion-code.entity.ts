/**
 * Stripe Promotion Code validation result entity.
 * This is a transient entity used for API responses, not stored in the database.
 */
export type StripeCouponDuration = "forever" | "once" | "repeating";

const STRIPE_COUPON_DURATIONS: readonly StripeCouponDuration[] = ["forever", "once", "repeating"];

/**
 * Narrow a Stripe coupon duration to the durations this system understands.
 *
 * stripe@22 widens response enums with `OtherString`, so a value the Stripe API adds in
 * future still typechecks as `Coupon.Duration`. Anything outside the known set is reported
 * as absent rather than returned as a value the response type claims is impossible.
 */
export function toStripeCouponDuration(value: string | undefined): StripeCouponDuration | undefined {
  return STRIPE_COUPON_DURATIONS.find((duration) => duration === value);
}

export interface StripePromotionCode {
  id: string;
  valid: boolean;
  promotionCodeId?: string;
  code: string;
  discountType?: "percent_off" | "amount_off";
  discountValue?: number;
  currency?: string;
  duration?: StripeCouponDuration;
  durationInMonths?: number;
  errorMessage?: string;
}
