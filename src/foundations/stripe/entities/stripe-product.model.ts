import { DataModelInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeProduct } from "../entities/stripe-product.entity";
import { mapStripeProduct } from "../entities/stripe-product.map";
import { stripeProductMeta } from "../entities/stripe-product.meta";
import { StripeProductSerialiser } from "../serialisers/stripe-product.serialiser";

export const StripeProductModel: DataModelInterface<StripeProduct> = {
  ...stripeProductMeta,
  entity: undefined as unknown as StripeProduct,
  mapper: mapStripeProduct,
  serialiser: StripeProductSerialiser,
  singleChildrenTokens: [],
  childrenTokens: [],
};
