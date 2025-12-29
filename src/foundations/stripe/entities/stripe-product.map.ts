import { mapEntity } from "@carlonicora/nestjs-neo4jsonapi";
import { EntityFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeProduct } from "../entities/stripe-product.entity";

export const mapStripeProduct = (params: { data: any; record: any; entityFactory: EntityFactory }): StripeProduct => {
  return {
    ...mapEntity({ record: params.data }),
    stripeProductId: params.data.stripeProductId,
    name: params.data.name,
    description: params.data.description,
    active: params.data.active === true,
    metadata: params.data.metadata,
  };
};
