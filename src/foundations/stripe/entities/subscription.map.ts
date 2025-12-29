import { mapEntity } from "@carlonicora/nestjs-neo4jsonapi";
import { EntityFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { Subscription } from "../entities/subscription.entity";

export const mapSubscription = (params: { data: any; record: any; entityFactory: EntityFactory }): Subscription => {
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
    billingCustomer: undefined,
    price: undefined,
  };
};
