import { defineEntity, Entity } from "../../../common";
import type { Company } from "../../company/entities/company";
import { companyMeta } from "../../company/entities/company.meta";
import { referralVisitMeta } from "./referral-visit.meta";

/**
 * One visit to a company's referral link (counted once per browser by the web).
 * Never feeds a reward.
 */
export type ReferralVisit = Entity & {
  company?: Company;
};

export const ReferralVisitDescriptor = defineEntity<ReferralVisit>()({
  ...referralVisitMeta,
  isCompanyScoped: false,
  tenancy: "internal",
  fields: {},
  relationships: {
    company: {
      model: companyMeta,
      direction: "out",
      relationship: "VISITED",
      cardinality: "one",
    },
  },
});

export type ReferralVisitDescriptorType = typeof ReferralVisitDescriptor;
