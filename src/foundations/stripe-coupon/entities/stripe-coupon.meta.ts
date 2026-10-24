import { DataMeta } from "../../../common/interfaces/datamodel.interface";

export const stripeCouponMeta: DataMeta = {
  type: "stripe-coupons",
  endpoint: "stripe-coupons",
  nodeName: "stripeCoupon",
  labelName: "StripeCoupon",
};

/** Path segment of the count refresh route: `${stripeCouponMeta.endpoint}/:couponId/${STRIPE_COUPON_REFRESH_SEGMENT}`. */
export const STRIPE_COUPON_REFRESH_SEGMENT = "refresh";
