import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { analyticsDailyUniqueTimelineMeta } from "./analytics-daily-unique-timeline.meta";

/**
 * One calendar day of the daily unique visitors / unique users charts. Always
 * daily, across every section. `id` is the day string `YYYY-MM-DD`.
 *
 * `visitors` / `users` are `null` when the day is unknown (summarised before the
 * daily uniques were stored); the chart draws that as a gap, never a zero.
 *
 * `day` is a calendar day with no time component, so it is `type: "date"` —
 * never `"string"`. See references/date-handling.md rule 1.
 *
 * NOT a Neo4j node — serialisation shape only, so `visitors` and `users` sit in
 * `fields`: there is no record for `computed` to read (approved exception,
 * 2026-11-04).
 */
export type AnalyticsDailyUniqueTimelineEntity = Entity & {
  day: string;
  visitors: number | null;
  users: number | null;
};

export const AnalyticsDailyUniqueTimelineDescriptor = defineEntity<AnalyticsDailyUniqueTimelineEntity>()({
  ...analyticsDailyUniqueTimelineMeta,

  isCompanyScoped: false,
  tenancy: "internal",

  fields: {
    day: { type: "date", required: true },
    visitors: { type: "number" },
    users: { type: "number" },
  },

  relationships: {},
});

export type AnalyticsDailyUniqueTimelineDescriptorType = typeof AnalyticsDailyUniqueTimelineDescriptor;
