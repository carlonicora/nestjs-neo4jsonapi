import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { StripePrice } from "../entities/stripe-price.entity";

export const mapStripePrice = (params: { data: any; record: any; entityFactory: EntityFactory }): StripePrice => {
  return {
    ...mapEntity({ record: params.data }),
    stripePriceId: params.data.stripePriceId,
    active: params.data.active === true,
    currency: params.data.currency,
    unitAmount: params.data.unitAmount ? Number(params.data.unitAmount) : undefined,
    priceType: params.data.priceType,
    recurringInterval: params.data.recurringInterval,
    recurringIntervalCount: params.data.recurringIntervalCount ? Number(params.data.recurringIntervalCount) : undefined,
    recurringUsageType: params.data.recurringUsageType,
    nickname: params.data.nickname,
    lookupKey: params.data.lookupKey,
    metadata: params.data.metadata,
    description: params.data.description,
    features: params.data.features,
    token: params.data.token ? Number(params.data.token) : undefined,
    stripeProduct: undefined,
    feature: [], // Initialize relationship array (naming follows Company pattern)
  };
};
