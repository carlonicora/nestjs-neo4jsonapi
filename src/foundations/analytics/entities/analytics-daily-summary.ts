import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { Audience } from "../common/analytics.admin.filters";
import { analyticsDailySummaryMeta } from "./analytics-daily-summary.meta";

/**
 * AnalyticsDailySummary Entity Type
 *
 * One (date, audience, dimension, key) roll-up row, produced by the retention job
 * before a day's raw sessions and page views are deleted. `id` is
 * `${date}|${audience}|${dimension}|${key}`; `audience` is `visitors` or
 * `users`; `dimension` is `total`, `source`, `medium`, `campaign`, `referrer`,
 * `route`, `landing` or `exit`; `key` is the empty string for `total`.
 */
export type AnalyticsDailySummary = Entity & {
  date: string;
  audience: Audience;
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
    audience: { type: "string", required: true },
    dimension: { type: "string", required: true },
    key: { type: "string", required: true },
    visitors: { type: "number", required: true },
    sessions: { type: "number", required: true },
    pageViews: { type: "number", required: true },
  },

  relationships: {},
});

export type AnalyticsDailySummaryDescriptorType = typeof AnalyticsDailySummaryDescriptor;
