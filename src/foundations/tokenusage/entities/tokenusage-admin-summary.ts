import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { tokenUsageAdminSummaryMeta } from "./tokenusage-admin-summary.meta";

/**
 * One row of the admin summary: a cost centre observed over one time window.
 *
 * Six rows are returned per request — scope ("customer" | "platform" | "total")
 * crossed with window ("current" | "previous") — which is what lets the KPI
 * tiles render both the value and its delta without a second call.
 *
 * NOT a Neo4j node: there is no TokenUsageAdminSummary label and no repository
 * for this descriptor. It is a serialisation shape only, exactly like
 * `ReferralStatsDescriptor`.
 */
export type TokenUsageAdminSummaryEntity = Entity & {
  scope: string;
  window: string;
  cost: number;
  credits: number;
  tokensIn: number;
  tokensOut: number;
  cached: number;
  calls: number;
};

export const TokenUsageAdminSummaryDescriptor = defineEntity<TokenUsageAdminSummaryEntity>()({
  ...tokenUsageAdminSummaryMeta,

  isCompanyScoped: false,

  fields: {
    scope: { type: "string", required: true },
    window: { type: "string", required: true },
    cost: { type: "number", required: true },
    credits: { type: "number", required: true },
    tokensIn: { type: "number", required: true },
    tokensOut: { type: "number", required: true },
    cached: { type: "number", required: true },
    calls: { type: "number", required: true },
  },

  relationships: {},
});
