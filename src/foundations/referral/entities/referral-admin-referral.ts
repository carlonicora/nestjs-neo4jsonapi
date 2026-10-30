import { defineEntity, type Entity } from "../../../common";
import { referralAdminReferralMeta } from "./referral-admin-referral.meta";

/**
 * One Referral in the administrator referral report. `id` is the Referral id;
 * `name`/`email` are the referred company's earliest-created user's,
 * `referrerName`/`referrerEmail` the referrer company's (empty strings when a
 * company has no user).
 *
 * NOT a Neo4j node: a serialisation shape only, like AnalyticsSummaryDescriptor.
 */
export type ReferralAdminReferralEntity = Entity & {
  name: string;
  email: string;
  referrerName: string;
  referrerEmail: string;
  source: string;
  status: string;
  referredAt: Date;
  completedAt?: Date;
  tokensAwarded?: number;
};

export const ReferralAdminReferralDescriptor = defineEntity<ReferralAdminReferralEntity>()({
  ...referralAdminReferralMeta,

  isCompanyScoped: false,
  tenancy: "internal",

  fields: {
    name: { type: "string", required: true },
    email: { type: "string", required: true },
    referrerName: { type: "string", required: true },
    referrerEmail: { type: "string", required: true },
    source: { type: "string", required: true },
    status: { type: "string", required: true },
    referredAt: { type: "datetime", required: true },
    completedAt: { type: "datetime" },
    tokensAwarded: { type: "number" },
  },

  relationships: {},
});

export type ReferralAdminReferralDescriptorType = typeof ReferralAdminReferralDescriptor;
