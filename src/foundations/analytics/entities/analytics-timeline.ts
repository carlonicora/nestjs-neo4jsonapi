import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { analyticsTimelineMeta } from "./analytics-timeline.meta";

/**
 * One (bucket, section) cell of the traffic-over-time chart. Rows are flat; the
 * frontend pivots them into series.
 *
 * `bucket` is a calendar day/week/month start with no time component, so it is
 * `type: "date"` — never `"string"`. See references/date-handling.md rule 1.
 *
 * NOT a Neo4j node — serialisation shape only (see the summary descriptor).
 */
export type AnalyticsTimelineEntity = Entity & {
  bucket: string;
  section: string;
  visitors: number;
  sessions: number;
  pageViews: number;
};

export const AnalyticsTimelineDescriptor = defineEntity<AnalyticsTimelineEntity>()({
  ...analyticsTimelineMeta,

  isCompanyScoped: false,

  fields: {
    bucket: { type: "date", required: true },
    section: { type: "string", required: true },
    visitors: { type: "number", required: true },
    sessions: { type: "number", required: true },
    pageViews: { type: "number", required: true },
  },

  relationships: {},
});

export type AnalyticsTimelineDescriptorType = typeof AnalyticsTimelineDescriptor;
