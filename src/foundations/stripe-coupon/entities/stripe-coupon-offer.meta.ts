import { DataMeta } from "../../../common/interfaces/datamodel.interface";

/**
 * Synthetic resource: the public offer of the automatic code (places left). Never stored as a node.
 */
export const stripeCouponOfferMeta: DataMeta = {
  type: "stripe-coupon-offers",
  endpoint: "stripe-coupon-offers",
  nodeName: "stripeCouponOffer",
  labelName: "StripeCouponOffer",
};
