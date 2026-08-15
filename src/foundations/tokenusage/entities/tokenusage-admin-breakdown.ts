import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { tokenUsageAdminBreakdownMeta } from "./tokenusage-admin-breakdown.meta";
import { usageMetricFields, UsageMetrics } from "./usage-metric.fields";

/**
 * One ranked row of a breakdown. The same shape serves all three dimensions —
 * company, user and operation — which is why the three "by-X" endpoints
 * collapse into a single `breakdown?dimension=` route.
 *
 * `activeUsers` / `monthlyCredits` / `availableMonthlyCredits` are populated
 * only for `dimension=company`; they are absent on user and operation rows.
 *
 * NOT a Neo4j node — serialisation shape only (see the summary descriptor).
 */
export type TokenUsageAdminBreakdownEntity = Entity & {
  label: string;
  sublabel?: string;
  activeUsers?: number;
  monthlyCredits?: number;
  availableMonthlyCredits?: number;
} & UsageMetrics;

export const TokenUsageAdminBreakdownDescriptor = defineEntity<TokenUsageAdminBreakdownEntity>()({
  ...tokenUsageAdminBreakdownMeta,

  isCompanyScoped: false,

  fields: {
    label: { type: "string", required: true },
    sublabel: { type: "string" },
    ...usageMetricFields,
    activeUsers: { type: "number" },
    monthlyCredits: { type: "number" },
    availableMonthlyCredits: { type: "number" },
  },

  relationships: {},
});
