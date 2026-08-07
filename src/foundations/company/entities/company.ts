import { Entity, defineEntity } from "../../../common";
import type { Feature } from "../../feature/entities/feature";
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
  monthlyCredits: number;
  availableMonthlyCredits: number;
  availableExtraCredits: number;
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

  // Company is the TENANT ROOT: every other entity is scoped to a company, so the
  // company itself has no parent company to filter by. Without this flag
  // `defineEntity` defaults `isCompanyScoped` to `true` and the generic query
  // builders inject a meaningless `(company)-[:BELONGS_TO]->(company)` synthetic
  // self-relationship into every read/write.
  isCompanyScoped: false,

  // Field definitions
  fields: {
    name: { type: "string", required: true },
    logo: { type: "string" },
    logoUrl: { type: "string" },
    // DELIBERATELY still serialised. Sibling applications (neural-erp, phlow) read
    // this attribute off the wire to drive their subscription banner
    // (`CommonSidebar.tsx`), so excluding it here would silently break them.
    // Applications that do not want it on their wire exclude it in their own
    // extension descriptor (a360ai does exactly that).
    isActiveSubscription: { type: "boolean" },
    // Internal only: identifies the owning/admin account. Never belongs on the wire
    // (it leaks a user's email to every company reader) and has zero wire consumers
    // across all consuming applications.
    ownerEmail: { type: "string", excludeFromJsonApi: true },
    monthlyCredits: { type: "number" },
    availableMonthlyCredits: { type: "number" },
    availableExtraCredits: { type: "number" },
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
