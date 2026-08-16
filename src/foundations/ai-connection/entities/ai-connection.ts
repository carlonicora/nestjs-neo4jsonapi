import { defineEntity, Entity } from "../../../common";
import { Company } from "../../company/entities/company";
import { companyMeta } from "../../company/entities/company.meta";
import { aiConnectionMeta } from "./ai-connection.meta";

/**
 * AiConnection Entity Type
 *
 * One node = one link in a fallback chain. A chain is identified by
 * `(connectionType, companyId | null)` and ordered by `position`.
 */
export type AiConnection = Entity & {
  name: string;
  connectionType: string;
  provider: string;
  position: number;
  enabled: boolean;
  model?: string;
  url?: string;
  apiKey?: string;
  region?: string;
  instance?: string;
  apiVersion?: string;
  googleCredentialsBase64?: string;
  allowFallbacks?: boolean;
  reasoningEffort?: string;
  maxOutputTokens?: number;
  dimensions?: number;
  inputCostPer1MTokens?: number;
  outputCostPer1MTokens?: number;
  cachedInputCostPer1MTokens?: number;
  costPerMinute?: number;
  costPerPage?: number;
  directUrl?: string;
  language?: string;
  directFormat?: string;
  directProvider?: string;
  /** Computed — id of the CONFIGURES target; absent = global chain. */
  companyId?: string;
  company?: Company;
};

/**
 * AiConnection Entity Descriptor
 *
 * Single source of truth for the AiConnection entity configuration.
 * Auto-generates mapper, serialiser, constraints, and indexes.
 */
export const AiConnectionDescriptor = defineEntity<AiConnection>()({
  ...aiConnectionMeta,

  // Deliberately NOT company-scoped: platform admins manage ALL chains, and the
  // resolver queries by company explicitly (spec § 1 "Company scoping").
  isCompanyScoped: false,

  fields: {
    name: { type: "string", required: true },
    connectionType: { type: "string", required: true, excludeFromSearch: true },
    provider: { type: "string", required: true, excludeFromSearch: true },
    position: { type: "number", required: true },
    enabled: { type: "boolean", required: true, default: true },
    model: { type: "string", excludeFromSearch: true },
    url: { type: "string", excludeFromSearch: true },
    // serialise: false — encrypted at rest AND never on the wire (spec § Decisions "Secrets")
    apiKey: { type: "string", excludeFromSearch: true, serialise: false },
    region: { type: "string", excludeFromSearch: true },
    instance: { type: "string", excludeFromSearch: true },
    apiVersion: { type: "string", excludeFromSearch: true },
    googleCredentialsBase64: { type: "string", excludeFromSearch: true, serialise: false },
    allowFallbacks: { type: "boolean" },
    reasoningEffort: { type: "string", excludeFromSearch: true },
    maxOutputTokens: { type: "number" },
    dimensions: { type: "number" },
    inputCostPer1MTokens: { type: "number" },
    outputCostPer1MTokens: { type: "number" },
    cachedInputCostPer1MTokens: { type: "number" },
    costPerMinute: { type: "number" },
    costPerPage: { type: "number" },
    directUrl: { type: "string", excludeFromSearch: true },
    language: { type: "string", excludeFromSearch: true },
    directFormat: { type: "string", excludeFromSearch: true },
    directProvider: { type: "string", excludeFromSearch: true },
  },

  computed: {
    companyId: {
      compute: (params) => {
        if (!params.record?.has?.("aiConnection_company")) return undefined;
        return params.record.get("aiConnection_company")?.properties?.id ?? undefined;
      },
    },
  },

  virtualFields: {
    hasApiKey: { compute: ({ data }) => !!data?.apiKey },
    hasGoogleCredentials: { compute: ({ data }) => !!data?.googleCredentialsBase64 },
  },

  relationships: {
    company: {
      model: companyMeta,
      direction: "out",
      relationship: "CONFIGURES",
      cardinality: "one",
      required: false,
      dtoKey: "company",
      // Scope is chosen at creation and never moves (spec § Decisions "Scope
      // mutability") — immutable relationships are skipped on PUT.
      immutable: true,
    },
  },
});

export type AiConnectionDescriptorType = typeof AiConnectionDescriptor;
