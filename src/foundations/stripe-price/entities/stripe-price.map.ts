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
    // 0 is a real allowance (a plan without AI credits), not "not configured"
    token: params.data.token !== undefined && params.data.token !== null ? Number(params.data.token) : undefined,
    isTrial: params.data.isTrial === true,
    stripeProduct: undefined,
    feature: [], // Initialize relationship array (naming follows Company pattern)
  };
};
