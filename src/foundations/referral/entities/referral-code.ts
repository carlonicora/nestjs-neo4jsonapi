import { defineEntity, type Entity } from "../../../common";

import { referralCodeMeta } from "./referral-code.meta";

export type ReferralCode = Entity & {
  referralCode: string;
};

export const ReferralCodeDescriptor = defineEntity<ReferralCode>()({
  ...referralCodeMeta,
  isCompanyScoped: false,
  fields: {
    referralCode: { type: "string", required: true },
  },
  relationships: {},
});
