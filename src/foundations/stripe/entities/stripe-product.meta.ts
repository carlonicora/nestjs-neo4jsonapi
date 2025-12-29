import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";

export const stripeProductMeta: DataMeta = {
  type: "stripe-products",
  endpoint: "stripe-products",
  nodeName: "stripeProduct",
  labelName: "StripeProduct",
};
