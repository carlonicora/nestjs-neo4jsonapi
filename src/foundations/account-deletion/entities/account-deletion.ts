import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { accountDeletionMeta } from "./account-deletion.meta";

/**
 * The account-deletion preview / status of one user. `id` is the user id.
 *
 * NOT a Neo4j node: there is no AccountDeletion label and no query returns
 * one. It is a serialisation shape only (like `AnalyticsSummaryDescriptor`);
 * AccountDeletionModule lists its serialiser and registers the model (OD-2).
 */
export type AccountDeletion = Entity & {
  requestedAt?: Date;
  scheduledAt?: Date;
  hasDeliverableEmail: boolean;
  hasActiveSubscription: boolean;
  deletesCompany: boolean;
  ownedCount: number;
  otherTables: string[];
};

export const AccountDeletionDescriptor = defineEntity<AccountDeletion>()({
  ...accountDeletionMeta,

  isCompanyScoped: false,
  tenancy: "internal",

  fields: {
    requestedAt: { type: "datetime" },
    scheduledAt: { type: "datetime" },
    hasDeliverableEmail: { type: "boolean", required: true },
    hasActiveSubscription: { type: "boolean", required: true },
    deletesCompany: { type: "boolean", required: true },
    ownedCount: { type: "number", required: true },
    otherTables: { type: "string[]", required: true },
  },

  relationships: {},
});

export type AccountDeletionDescriptorType = typeof AccountDeletionDescriptor;
