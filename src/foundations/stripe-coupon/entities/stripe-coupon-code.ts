import { Entity, defineEntity } from "../../../common";
import type { StripeCoupon } from "./stripe-coupon";
import { stripeCouponCodeMeta } from "./stripe-coupon-code.meta";
import { stripeCouponMeta } from "./stripe-coupon.meta";

export type StripeCouponCode = Entity & {
  stripePromotionCodeId: string;
  code: string;
  active: boolean;
  automatic: boolean;
  firstTimeTransaction: boolean;
  minimumAmount?: number; // minor units
  minimumAmountCurrency?: string;
  stripeCustomerId?: string;
  expiresAt?: Date;
  maxRedemptions?: number;
  timesRedeemed: number;
  coupon?: StripeCoupon;
};

export const StripeCouponCodeDescriptor = defineEntity<StripeCouponCode>()({
  ...stripeCouponCodeMeta,

  // Codes belong to a (non company-scoped) coupon
  isCompanyScoped: false,

  fields: {
    stripePromotionCodeId: { type: "string", required: true },
    code: { type: "string" },
    active: { type: "boolean", required: true, default: true },
    automatic: { type: "boolean", required: true, default: false },
    firstTimeTransaction: { type: "boolean", required: true, default: false },
    minimumAmount: { type: "number" },
    minimumAmountCurrency: { type: "string" },
    stripeCustomerId: { type: "string" },
    expiresAt: { type: "datetime" },
    maxRedemptions: { type: "number" },
    timesRedeemed: { type: "number", required: true, default: 0 },
  },

  relationships: {
    coupon: {
      model: stripeCouponMeta,
      direction: "in",
      relationship: "HAS_CODE",
      cardinality: "one",
      required: true,
      dtoKey: "coupon",
    },
  },
});

export type StripeCouponCodeDescriptorType = typeof StripeCouponCodeDescriptor;
