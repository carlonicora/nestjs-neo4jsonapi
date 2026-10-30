import { DataMeta } from "../../../common";

/**
 * `endpoint` is the route of the public visit POST; a ReferralVisit is never
 * served as a resource.
 */
export const referralVisitMeta: DataMeta = {
  type: "referral-visits",
  endpoint: "referrals/visits",
  nodeName: "referralVisit",
  labelName: "ReferralVisit",
};
