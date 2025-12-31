import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { StripeUsageRecord } from "./stripe-usage-record.entity";

export const mapStripeUsageRecord = (params: {
  data: any;
  record: any;
  entityFactory: EntityFactory;
}): StripeUsageRecord => {
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
