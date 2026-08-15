import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { tokenUsageAdminSummaryMeta } from "./tokenusage-admin-summary.meta";
import { usageMetricFields, UsageMetrics } from "./usage-metric.fields";

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
} & UsageMetrics;

export const TokenUsageAdminSummaryDescriptor = defineEntity<TokenUsageAdminSummaryEntity>()({
  ...tokenUsageAdminSummaryMeta,

  isCompanyScoped: false,

  fields: {
    scope: { type: "string", required: true },
    window: { type: "string", required: true },
    ...usageMetricFields,
  },

  relationships: {},
});
