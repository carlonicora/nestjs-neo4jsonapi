import { DataModelInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { StripePrice } from "../entities/stripe-price.entity";
import { mapStripePrice } from "../entities/stripe-price.map";
import { stripePriceMeta } from "../entities/stripe-price.meta";
import { stripeProductMeta } from "../entities/stripe-product.meta";
import { StripePriceSerialiser } from "../serialisers/stripe-price.serialiser";

export const StripePriceModel: DataModelInterface<StripePrice> = {
  ...stripePriceMeta,
  entity: undefined as unknown as StripePrice,
  mapper: mapStripePrice,
  serialiser: StripePriceSerialiser,
  singleChildrenTokens: [stripeProductMeta.nodeName],
  childrenTokens: [],
};
