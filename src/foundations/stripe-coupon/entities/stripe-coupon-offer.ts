import { Entity, defineEntity } from "../../../common";
import type { StripeCouponDiscountType, StripeCouponDurationType } from "./stripe-coupon";
import { stripeCouponOfferMeta } from "./stripe-coupon-offer.meta";

/**
 * Synthetic resource built from the automatic code and its coupon (`id` = the StripeCouponCode id); never a node.
 */
export type StripeCouponOffer = Entity & {
  discountType: StripeCouponDiscountType;
  percentOff?: number;
  amountOff?: number;
  currency?: string;
  duration: StripeCouponDurationType;
  durationInMonths?: number;
  placesLeft: number;
  placesTotal: number;
};

export const StripeCouponOfferDescriptor = defineEntity<StripeCouponOffer>()({
  ...stripeCouponOfferMeta,
  isCompanyScoped: false,
  fields: {
    discountType: { type: "string", required: true },
    percentOff: { type: "number" },
    amountOff: { type: "number" },
    currency: { type: "string" },
    duration: { type: "string", required: true },
    durationInMonths: { type: "number" },
    placesLeft: { type: "number", required: true },
    placesTotal: { type: "number", required: true },
  },
  relationships: {},
});

export type StripeCouponOfferDescriptorType = typeof StripeCouponOfferDescriptor;
