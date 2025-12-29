import { DataModelInterface } from "@carlonicora/nestjs-neo4jsonapi";
import { subscriptionMeta } from "../entities/subscription.meta";
import { UsageRecord } from "../entities/usage-record.entity";
import { mapUsageRecord } from "../entities/usage-record.map";
import { usageRecordMeta } from "../entities/usage-record.meta";
import { UsageRecordSerialiser } from "../serialisers/usage-record.serialiser";

export const UsageRecordModel: DataModelInterface<UsageRecord> = {
  ...usageRecordMeta,
  entity: undefined as unknown as UsageRecord,
  mapper: mapUsageRecord,
  serialiser: UsageRecordSerialiser,
  singleChildrenTokens: [subscriptionMeta.nodeName],
  childrenTokens: [],
};
