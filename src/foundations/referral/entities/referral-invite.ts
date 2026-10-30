import { defineEntity, Entity } from "../../../common";
import type { Company } from "../../company/entities/company";
import { companyMeta } from "../../company/entities/company.meta";
import type { User } from "../../user/entities/user";
import { userMeta } from "../../user/entities/user.meta";
import { referralInviteMeta } from "./referral-invite.meta";

/**
 * One referral invite email sent by a user of a company. The invitee address is
 * never stored.
 */
export type ReferralInvite = Entity & {
  company?: Company;
  sender?: User;
};

export const ReferralInviteDescriptor = defineEntity<ReferralInvite>()({
  ...referralInviteMeta,
  isCompanyScoped: false,
  tenancy: "internal",
  fields: {},
  relationships: {
    company: {
      model: companyMeta,
      direction: "out",
      relationship: "SENT_BY",
      cardinality: "one",
    },
    sender: {
      model: userMeta,
      direction: "out",
      relationship: "SENT_BY_USER",
      cardinality: "one",
    },
  },
});

export type ReferralInviteDescriptorType = typeof ReferralInviteDescriptor;
