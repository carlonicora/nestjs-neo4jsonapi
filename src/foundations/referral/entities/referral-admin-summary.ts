import { defineEntity, type Entity } from "../../../common";
import { referralAdminSummaryMeta } from "./referral-admin-summary.meta";

/**
 * One window of the administrator referral report: "current" (the selected
 * period) or "previous" (the equal-length span before it, absent for "all").
 * `window` is also the id.
 *
 * NOT a Neo4j node: a serialisation shape only, like AnalyticsSummaryDescriptor.
 * The report columns are fields, not computed properties, because the
 * serialiser emits computed values into meta, not attributes.
 */
export type ReferralAdminSummaryEntity = Entity & {
  window: string;
  visits: number;
  invitesSent: number;
  signups: number;
  paying: number;
  creditsGiven: number;
  sharingCompanies: number;
  eligibleCompanies: number;
};

export const ReferralAdminSummaryDescriptor = defineEntity<ReferralAdminSummaryEntity>()({
  ...referralAdminSummaryMeta,

  isCompanyScoped: false,
  tenancy: "internal",

  fields: {
    window: { type: "string", required: true },
    visits: { type: "number", required: true },
    invitesSent: { type: "number", required: true },
    signups: { type: "number", required: true },
    paying: { type: "number", required: true },
    creditsGiven: { type: "number", required: true },
    sharingCompanies: { type: "number", required: true },
    eligibleCompanies: { type: "number", required: true },
  },

  relationships: {},
});

export type ReferralAdminSummaryDescriptorType = typeof ReferralAdminSummaryDescriptor;
