import { defineEntity, Entity } from "../../../common";
import type { Company } from "../../company/entities/company";
import { companyMeta } from "../../company/entities/company.meta";
import { referralMeta } from "./referral.meta";

/**
 * Referral Entity Type
 */
export type Referral = Entity & {
  status: string;
  completedAt?: Date;
  tokensAwarded?: number;

  referrer?: Company;
  referred?: Company;
};

/**
 * Referral Entity Descriptor
 *
 * Single source of truth for the Referral entity configuration.
 * Generates mapper, childrenTokens, and DataModelInterface automatically.
 */
export const ReferralDescriptor = defineEntity<Referral>()({
  ...referralMeta,

  // Field definitions
  fields: {
    status: { type: "string", required: true },
    completedAt: { type: "datetime" },
    tokensAwarded: { type: "number" },
  },

  // Relationship definitions
  relationships: {
    referrer: {
      model: companyMeta,
      direction: "out",
      relationship: "REFERRED_BY",
      cardinality: "one",
    },
    referred: {
      model: companyMeta,
      direction: "out",
      relationship: "REFERS_TO",
      cardinality: "one",
    },
  },
});

// Type export for the descriptor
export type ReferralDescriptorType = typeof ReferralDescriptor;
