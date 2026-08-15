import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { tokenUsageReportBreakdownMeta } from "./tokenusage-report-breakdown.meta";
import { usageMetricFields, UsageMetrics } from "./usage-metric.fields";

/**
 * One ranked row of a self-service breakdown. The same shape serves both
 * dimensions — operation and target — which is why the two "by-X" panels
 * collapse into a single `breakdown?dimension=` route.
 *
 * Deliberately WITHOUT the administrative breakdown's activeUsers /
 * monthlyCredits / availableMonthlyCredits: those exist for the company
 * dimension only, and the self-service page reads the caller's own balances from
 * CurrentUserContext instead.
 *
 * NOT a Neo4j node — serialisation shape only.
 */
export type TokenUsageReportBreakdownEntity = Entity & {
  label: string;
  sublabel?: string;
} & UsageMetrics;

export const TokenUsageReportBreakdownDescriptor = defineEntity<TokenUsageReportBreakdownEntity>()({
  ...tokenUsageReportBreakdownMeta,

  isCompanyScoped: false,

  fields: {
    label: { type: "string", required: true },
    sublabel: { type: "string" },
    ...usageMetricFields,
  },

  relationships: {},
});
