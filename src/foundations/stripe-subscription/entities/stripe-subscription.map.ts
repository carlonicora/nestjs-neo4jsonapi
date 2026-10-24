import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { StripeSubscription } from "./stripe-subscription.entity";

export const mapStripeSubscription = (params: {
  data: any;
  record: any;
  entityFactory: EntityFactory;
}): StripeSubscription => {
  return {
    ...mapEntity({ record: params.data }),
    stripeSubscriptionId: params.data.stripeSubscriptionId,
    stripeSubscriptionItemId: params.data.stripeSubscriptionItemId,
    status: params.data.status,
    currentPeriodStart: params.data.currentPeriodStart ? new Date(params.data.currentPeriodStart) : new Date(),
    currentPeriodEnd: params.data.currentPeriodEnd ? new Date(params.data.currentPeriodEnd) : new Date(),
    cancelAtPeriodEnd: params.data.cancelAtPeriodEnd === true,
    canceledAt: params.data.canceledAt ? new Date(params.data.canceledAt) : undefined,
    trialStart: params.data.trialStart ? new Date(params.data.trialStart) : undefined,
    trialEnd: params.data.trialEnd ? new Date(params.data.trialEnd) : undefined,
    pausedAt: params.data.pausedAt ? new Date(params.data.pausedAt) : undefined,
    quantity: Number(params.data.quantity ?? 1),
    discountPercentOff: params.data.discountPercentOff != null ? Number(params.data.discountPercentOff) : undefined,
    discountAmountOff: params.data.discountAmountOff != null ? Number(params.data.discountAmountOff) : undefined,
    discountCurrency: params.data.discountCurrency ?? undefined,
    discountDuration: params.data.discountDuration ?? undefined,
    discountDurationInMonths:
      params.data.discountDurationInMonths != null ? Number(params.data.discountDurationInMonths) : undefined,
    discountEnd: params.data.discountEnd ? new Date(params.data.discountEnd) : undefined,
    stripeCustomer: undefined,
    stripePrice: undefined,
  };
};
