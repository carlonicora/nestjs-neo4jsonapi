import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { stripeSubscriptionMeta } from "../../stripe-subscription/entities/stripe-subscription.meta";
import { UsageRecord } from "../entities/usage-record.entity";
import { mapUsageRecord } from "../entities/usage-record.map";
import { usageRecordMeta } from "../entities/usage-record.meta";
import { UsageRecordSerialiser } from "../serialisers/usage-record.serialiser";

export const UsageRecordModel: DataModelInterface<UsageRecord> = {
  ...usageRecordMeta,
  entity: undefined as unknown as UsageRecord,
  mapper: mapUsageRecord,
  serialiser: UsageRecordSerialiser,
  singleChildrenTokens: [stripeSubscriptionMeta.nodeName],
  childrenTokens: [],
};
