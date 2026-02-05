import { defineEntity, type Entity } from "../../../common";

import { referralStatsMeta } from "./referral-stats.meta";

export type ReferralStatsEntity = Entity & {
  referralCode: string;
  completedReferrals: number;
  totalTokensEarned: number;
};

export const ReferralStatsDescriptor = defineEntity<ReferralStatsEntity>()({
  ...referralStatsMeta,
  isCompanyScoped: false,
  fields: {
    referralCode: { type: "string", required: true },
    completedReferrals: { type: "number", required: true },
    totalTokensEarned: { type: "number", required: true },
  },
  relationships: {},
});
