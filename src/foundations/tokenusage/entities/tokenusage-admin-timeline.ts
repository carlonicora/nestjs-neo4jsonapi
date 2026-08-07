import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { tokenUsageAdminTimelineMeta } from "./tokenusage-admin-timeline.meta";

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
  cost: number;
  credits: number;
  tokensIn: number;
  tokensOut: number;
  cached: number;
  calls: number;
};

export const TokenUsageAdminTimelineDescriptor = defineEntity<TokenUsageAdminTimelineEntity>()({
  ...tokenUsageAdminTimelineMeta,

  isCompanyScoped: false,

  fields: {
    bucket: { type: "date", required: true },
    series: { type: "string", required: true },
    cost: { type: "number", required: true },
    credits: { type: "number", required: true },
    tokensIn: { type: "number", required: true },
    tokensOut: { type: "number", required: true },
    cached: { type: "number", required: true },
    calls: { type: "number", required: true },
  },

  relationships: {},
});
