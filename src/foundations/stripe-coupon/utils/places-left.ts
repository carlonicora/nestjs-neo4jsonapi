import type { StripeCoupon } from "../entities/stripe-coupon";
import type { StripeCouponCode } from "../entities/stripe-coupon-code";

type CodeLimits = Pick<StripeCouponCode, "maxRedemptions" | "timesRedeemed">;
type CouponLimits = Pick<StripeCoupon, "maxRedemptions" | "timesRedeemed">;

const isSet = (value: number | null | undefined): value is number => value !== undefined && value !== null;

/**
 * Places left for a code: the smaller of (coupon limit - coupon redeemed) and
 * (code limit - code redeemed), counting only the limits that are set. Never below zero.
 *
 * @returns null when neither limit is set (unlimited)
 */
export function placesLeft(code: CodeLimits, coupon: CouponLimits): number | null {
  const remaining: number[] = [];
  if (isSet(coupon.maxRedemptions)) remaining.push(coupon.maxRedemptions - (coupon.timesRedeemed ?? 0));
  if (isSet(code.maxRedemptions)) remaining.push(code.maxRedemptions - (code.timesRedeemed ?? 0));
  if (remaining.length === 0) return null;
  return Math.max(0, Math.min(...remaining));
}

/**
 * Total places for a code: the smaller of the set limits (coupon and code).
 *
 * @returns null when neither limit is set (unlimited)
 */
export function placesTotal(code: CodeLimits, coupon: CouponLimits): number | null {
  const limits = [coupon.maxRedemptions, code.maxRedemptions].filter(isSet);
  if (limits.length === 0) return null;
  return Math.min(...limits);
}
