import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";

export const stripePriceMeta: DataMeta = {
  type: "stripe-prices",
  endpoint: "stripe-prices",
  nodeName: "stripePrice",
  labelName: "StripePrice",
};
