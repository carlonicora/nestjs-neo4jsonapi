import { Entity, defineEntity } from "../../../common";
import type { StripeCouponCode } from "./stripe-coupon-code";
import { stripeCouponCodeMeta } from "./stripe-coupon-code.meta";
import { stripeCouponMeta } from "./stripe-coupon.meta";

/**
 * A coupon's discount, one shape per kind (input side). The entity and its descriptor keep the fields flat.
 * `amountOff` is in minor units (cents); `currency` is lowercase ISO.
 */
export type StripeCouponDiscountTerms =
  | { discountType: "percent_off"; percentOff: number }
  | { discountType: "amount_off"; amountOff: number; currency: string };

/**
 * A coupon's duration, one shape per kind (input side). The entity and its descriptor keep the fields flat.
 */
export type StripeCouponDurationTerms =
  { duration: "once" } | { duration: "forever" } | { duration: "repeating"; durationInMonths: number };

export type StripeCouponDiscountType = StripeCouponDiscountTerms["discountType"];
export type StripeCouponDurationType = StripeCouponDurationTerms["duration"];

export type StripeCoupon = Entity & {
  stripeCouponId: string;
  name: string;
  discountType: StripeCouponDiscountType;
  percentOff?: number; // 0.01–100
  amountOff?: number; // minor units (cents)
  currency?: string; // lowercase ISO, with amountOff
  duration: StripeCouponDurationType;
  durationInMonths?: number; // with "repeating"
  stripeProductIds?: string[]; // Stripe product ids; empty = every product
  redeemBy?: Date;
  maxRedemptions?: number;
  timesRedeemed: number;
  valid: boolean;
  codes?: StripeCouponCode[];
};

export const StripeCouponDescriptor = defineEntity<StripeCoupon>()({
  ...stripeCouponMeta,

  // Coupons are NOT company-scoped - administrators manage them for the whole platform, like products
  isCompanyScoped: false,

  fields: {
    stripeCouponId: { type: "string" },
    name: { type: "string", required: true },
    discountType: { type: "string", required: true },
    percentOff: { type: "number" },
    amountOff: { type: "number" },
    currency: { type: "string" },
    duration: { type: "string", required: true },
    durationInMonths: { type: "number" },
    stripeProductIds: { type: "string[]" },
    redeemBy: { type: "datetime" },
    maxRedemptions: { type: "number" },
    timesRedeemed: { type: "number", required: true, default: 0 },
    valid: { type: "boolean", required: true, default: true },
  },

  relationships: {
    codes: {
      model: stripeCouponCodeMeta,
      direction: "out",
      relationship: "HAS_CODE",
      cardinality: "many",
      required: false,
      dtoKey: "codes",
    },
  },
});

export type StripeCouponDescriptorType = typeof StripeCouponDescriptor;
