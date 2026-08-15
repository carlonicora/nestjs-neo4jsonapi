import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { tokenUsageAdminTimelineMeta } from "./tokenusage-admin-timeline.meta";
import { usageMetricFields, UsageMetrics } from "./usage-metric.fields";

/**
 * One (bucket, series) cell of the usage-over-time chart. Rows are flat; the
 * frontend pivots them into stacked columns.
 *
 * `bucket` is a calendar day/week/month start with no time component, so it is
 * `type: "date"` — never `"string"`. See references/date-handling.md rule 1.
 *
 * NOT a Neo4j node — serialisation shape only (see the summary descriptor).
 */
export type TokenUsageAdminTimelineEntity = Entity & {
  bucket: string;
  series: string;
} & UsageMetrics;

export const TokenUsageAdminTimelineDescriptor = defineEntity<TokenUsageAdminTimelineEntity>()({
  ...tokenUsageAdminTimelineMeta,

  isCompanyScoped: false,

  fields: {
    bucket: { type: "date", required: true },
    series: { type: "string", required: true },
    ...usageMetricFields,
  },

  relationships: {},
});
