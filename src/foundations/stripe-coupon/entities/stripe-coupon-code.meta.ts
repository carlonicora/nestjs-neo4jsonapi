import { DataMeta } from "../../../common/interfaces/datamodel.interface";

export const stripeCouponCodeMeta: DataMeta = {
  type: "stripe-coupon-codes",
  endpoint: "stripe-coupon-codes",
  nodeName: "stripeCouponCode",
  labelName: "StripeCouponCode",
};

/** Path segment of the auto-apply lookup: `${stripeCouponCodeMeta.endpoint}/${STRIPE_COUPON_CODE_AUTOMATIC_SEGMENT}`. */
export const STRIPE_COUPON_CODE_AUTOMATIC_SEGMENT = "automatic";
