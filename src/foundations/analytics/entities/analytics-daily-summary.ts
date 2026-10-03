import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { analyticsDailySummaryMeta } from "./analytics-daily-summary.meta";

/**
 * AnalyticsDailySummary Entity Type
 *
 * One (date, section, dimension, key) roll-up row, produced by the retention job
 * before a day's raw sessions and page views are deleted. `id` is
 * `${date}|${section}|${dimension}|${key}`; `dimension` is `total`, `source`,
 * `medium`, `campaign`, `referrer`, `route` or `landing`; `key` is the empty
 * string for `total`.
 */
export type AnalyticsDailySummary = Entity & {
  date: string;
  section: string;
  dimension: string;
  key: string;
  visitors: number;
  sessions: number;
  pageViews: number;
};

/**
 * AnalyticsDailySummary Entity Descriptor
 *
 * Platform-level: no BELONGS_TO Company edge.
 *
 * `date` is a calendar day with no time component, so it is `type: "date"` —
 * never `"string"`. See references/date-handling.md rule 1.
 */
export const AnalyticsDailySummaryDescriptor = defineEntity<AnalyticsDailySummary>()({
  ...analyticsDailySummaryMeta,

  isCompanyScoped: false,

  fields: {
    date: { type: "date", required: true },
    section: { type: "string", required: true },
    dimension: { type: "string", required: true },
    key: { type: "string", required: true },
    visitors: { type: "number", required: true },
    sessions: { type: "number", required: true },
    pageViews: { type: "number", required: true },
  },

  relationships: {},
});

export type AnalyticsDailySummaryDescriptorType = typeof AnalyticsDailySummaryDescriptor;
