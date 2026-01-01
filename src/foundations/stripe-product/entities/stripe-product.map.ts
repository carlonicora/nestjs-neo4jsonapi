import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { StripeProduct } from "./stripe-product.entity";

export const mapStripeProduct = (params: { data: any; record: any; entityFactory: EntityFactory }): StripeProduct => {
  return {
    ...mapEntity({ record: params.data }),
    stripeProductId: params.data.stripeProductId,
    name: params.data.name,
    description: params.data.description,
    active: params.data.active === true,
    metadata: params.data.metadata,
    stripePrice: [],
  };
};
