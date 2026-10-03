import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { analyticsBreakdownMeta } from "./analytics-breakdown.meta";

/**
 * One (dimension, key) row of the admin breakdown tables: traffic grouped by
 * source, medium, campaign, referrer, route or landing route.
 *
 * NOT a Neo4j node — serialisation shape only (see the summary descriptor).
 */
export type AnalyticsBreakdownEntity = Entity & {
  dimension: string;
  key: string;
  visitors: number;
  sessions: number;
  pageViews: number;
};

export const AnalyticsBreakdownDescriptor = defineEntity<AnalyticsBreakdownEntity>()({
  ...analyticsBreakdownMeta,

  isCompanyScoped: false,

  fields: {
    dimension: { type: "string", required: true },
    key: { type: "string", required: true },
    visitors: { type: "number", required: true },
    sessions: { type: "number", required: true },
    pageViews: { type: "number", required: true },
  },

  relationships: {},
});

export type AnalyticsBreakdownDescriptorType = typeof AnalyticsBreakdownDescriptor;
