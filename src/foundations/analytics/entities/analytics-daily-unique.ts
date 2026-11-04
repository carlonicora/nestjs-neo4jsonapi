import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { analyticsDailyUniqueMeta } from "./analytics-daily-unique.meta";

/**
 * AnalyticsDailyUnique Entity Type
 *
 * The unique visitors and unique signed-in users of one UTC day, across every
 * section, written by the retention job before that day's raw sessions are
 * deleted. `id` is the date string `YYYY-MM-DD`.
 */
export type AnalyticsDailyUnique = Entity & {
  date: string;
  visitors: number;
  users: number;
};

/**
 * AnalyticsDailyUnique Entity Descriptor
 *
 * Platform-level: no BELONGS_TO Company edge, no relationships. An admin record
 * the assistant must never see, so `tenancy: "internal"`.
 *
 * `date` is a calendar day with no time component, so it is `type: "date"` —
 * never `"string"`. See references/date-handling.md rule 1.
 */
export const AnalyticsDailyUniqueDescriptor = defineEntity<AnalyticsDailyUnique>()({
  ...analyticsDailyUniqueMeta,

  isCompanyScoped: false,
  tenancy: "internal",

  fields: {
    date: { type: "date", required: true },
    visitors: { type: "number", required: true },
    users: { type: "number", required: true },
  },

  relationships: {},
});

export type AnalyticsDailyUniqueDescriptorType = typeof AnalyticsDailyUniqueDescriptor;
