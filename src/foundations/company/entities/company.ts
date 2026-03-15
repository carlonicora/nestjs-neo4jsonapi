import { Entity, defineEntity } from "../../../common";
import type { Feature } from "../../feature/entities/feature.entity";
import type { Module } from "../../module/entities/module.entity";
import { featureMeta } from "../../feature/entities/feature.meta";
import { moduleMeta } from "../../module/entities/module.meta";
import { companyMeta } from "./company.meta";

/**
 * Company Entity Type
 */
export type Company = Entity & {
  name: string;
  logo?: string;
  logoUrl?: string;
  isActiveSubscription: boolean;
  ownerEmail: string;
  monthlyTokens: number;
  availableMonthlyTokens: number;
  availableExtraTokens: number;
  configurations?: string;
  configuration?: any;

  // Deletion scheduling fields
  subscriptionEndedAt?: Date;
  scheduledDeletionAt?: Date;
  deactivationReason?: string;

  // Referral system
  referralCode?: string; // UUID referral code

  // Address fields
  legal_address?: string;
  street_number?: string;
  street?: string;
  city?: string;
  province?: string;
  region?: string;
  postcode?: string;
  country?: string;
  country_code?: string;

  // Fiscal data
  fiscal_data?: string;

  feature: Feature[];
  module: Module[];
};

/**
 * Company Entity Descriptor
 *
 * Single source of truth for the Company entity configuration.
 * Generates mapper, childrenTokens, and DataModelInterface automatically.
 */
export const CompanyDescriptor = defineEntity<Company>()({
  ...companyMeta,

  // Field definitions
  fields: {
    name: { type: "string", required: true },
    logo: { type: "string" },
    logoUrl: { type: "string" },
    isActiveSubscription: { type: "boolean" },
    ownerEmail: { type: "string" },
    monthlyTokens: { type: "number" },
    availableMonthlyTokens: { type: "number" },
    availableExtraTokens: { type: "number" },
    configurations: { type: "string" },
    configuration: { type: "string" },
    subscriptionEndedAt: { type: "datetime" },
    scheduledDeletionAt: { type: "datetime" },
    deactivationReason: { type: "string" },
    referralCode: { type: "string" },
    legal_address: { type: "string" },
    street_number: { type: "string" },
    street: { type: "string" },
    city: { type: "string" },
    province: { type: "string" },
    region: { type: "string" },
    postcode: { type: "string" },
    country: { type: "string" },
    country_code: { type: "string" },
    fiscal_data: { type: "string" },
  },

  // Relationship definitions
  relationships: {
    feature: {
      model: featureMeta,
      direction: "out",
      relationship: "HAS_FEATURE",
      cardinality: "many",
      dtoKey: "features",
    },
    module: {
      model: moduleMeta,
      direction: "out",
      relationship: "HAS_MODULE",
      cardinality: "many",
      dtoKey: "modules",
    },
  },
});

// Type export for the descriptor
export type CompanyDescriptorType = typeof CompanyDescriptor;
