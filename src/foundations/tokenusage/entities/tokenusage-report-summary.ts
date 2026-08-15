import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { tokenUsageReportSummaryMeta } from "./tokenusage-report-summary.meta";
import { usageMetricFields, UsageMetrics } from "./usage-metric.fields";

/**
 * One row of the self-service summary: the caller's own company observed over
 * one time window.
 *
 * TWO rows are returned per request — window "current" and "previous" — which is
 * what lets the KPI tile render both the value and its delta without a second
 * call. There is no `scope` field: the administrative customer/platform split is
 * meaningless inside a single tenant.
 *
 * NOT a Neo4j node: there is no TokenUsageReportSummary label. It is a
 * serialisation shape only, exactly like TokenUsageAdminSummaryDescriptor.
 */
export type TokenUsageReportSummaryEntity = Entity & {
  window: string;
} & UsageMetrics;

export const TokenUsageReportSummaryDescriptor = defineEntity<TokenUsageReportSummaryEntity>()({
  ...tokenUsageReportSummaryMeta,

  isCompanyScoped: false,

  fields: {
    window: { type: "string", required: true },
    ...usageMetricFields,
  },

  relationships: {},
});
