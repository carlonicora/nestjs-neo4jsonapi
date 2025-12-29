import { mapEntity } from "@carlonicora/nestjs-neo4jsonapi";
import { EntityFactory } from "@carlonicora/nestjs-neo4jsonapi";
import { UsageRecord } from "../entities/usage-record.entity";

export const mapUsageRecord = (params: { data: any; record: any; entityFactory: EntityFactory }): UsageRecord => {
  return {
    ...mapEntity({ record: params.data }),
    subscriptionId: params.data.subscriptionId,
    meterId: params.data.meterId,
    meterEventName: params.data.meterEventName,
    quantity: Number(params.data.quantity ?? 0),
    timestamp: params.data.timestamp ? new Date(params.data.timestamp) : new Date(),
    stripeEventId: params.data.stripeEventId || undefined,
    subscription: undefined,
  };
};
