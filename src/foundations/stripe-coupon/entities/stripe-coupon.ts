import { Entity, defineEntity } from "../../../common";
import type { StripeCouponCode } from "./stripe-coupon-code";
import { stripeCouponCodeMeta } from "./stripe-coupon-code.meta";
import { stripeCouponMeta } from "./stripe-coupon.meta";

export type StripeCouponDiscountType = "percent_off" | "amount_off";
export type StripeCouponDurationType = "once" | "repeating" | "forever";

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
    stripeCouponId: { type: "string", required: true },
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
