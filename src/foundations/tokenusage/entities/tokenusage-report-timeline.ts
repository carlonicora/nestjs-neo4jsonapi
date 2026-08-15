import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { tokenUsageReportTimelineMeta } from "./tokenusage-report-timeline.meta";
import { usageMetricFields, UsageMetrics } from "./usage-metric.fields";

/**
 * One (bucket, series) cell of the self-service usage-over-time chart. Rows are
 * flat; the frontend pivots them into stacked columns.
 *
 * `bucket` is a calendar day with no time component, so it is `type: "date"` —
 * never `"string"`. See references/date-handling.md rule 1.
 *
 * NOT a Neo4j node — serialisation shape only.
 */
export type TokenUsageReportTimelineEntity = Entity & {
  bucket: string;
  series: string;
} & UsageMetrics;

export const TokenUsageReportTimelineDescriptor = defineEntity<TokenUsageReportTimelineEntity>()({
  ...tokenUsageReportTimelineMeta,

  isCompanyScoped: false,

  fields: {
    bucket: { type: "date", required: true },
    series: { type: "string", required: true },
    ...usageMetricFields,
  },

  relationships: {},
});
