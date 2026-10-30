import { defineEntity, type Entity } from "../../../common";
import { referralAdminReferrerMeta } from "./referral-admin-referrer.meta";

/**
 * One referrer company in the administrator referral report. `id` is the
 * referrer company id; `name` and `email` are its earliest-created user's
 * (empty strings when the company has no user).
 *
 * NOT a Neo4j node: a serialisation shape only, like AnalyticsSummaryDescriptor.
 */
export type ReferralAdminReferrerEntity = Entity & {
  name: string;
  email: string;
  visits: number;
  invitesSent: number;
  signupsLink: number;
  signupsDirect: number;
  paying: number;
  creditsEarned: number;
  lastInviteAt?: Date;
};

export const ReferralAdminReferrerDescriptor = defineEntity<ReferralAdminReferrerEntity>()({
  ...referralAdminReferrerMeta,

  isCompanyScoped: false,
  tenancy: "internal",

  fields: {
    name: { type: "string", required: true },
    email: { type: "string", required: true },
    visits: { type: "number", required: true },
    invitesSent: { type: "number", required: true },
    signupsLink: { type: "number", required: true },
    signupsDirect: { type: "number", required: true },
    paying: { type: "number", required: true },
    creditsEarned: { type: "number", required: true },
    lastInviteAt: { type: "datetime" },
  },

  relationships: {},
});

export type ReferralAdminReferrerDescriptorType = typeof ReferralAdminReferrerDescriptor;
