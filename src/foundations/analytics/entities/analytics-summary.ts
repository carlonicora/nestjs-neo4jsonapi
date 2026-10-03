import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { analyticsSummaryMeta } from "./analytics-summary.meta";

/**
 * One row of the admin summary: a section observed over one time window.
 *
 * Six rows are returned per request — section ("public" | "app" | "total")
 * crossed with window ("current" | "previous") — which is what lets the KPI
 * tiles render both the value and its delta without a second call.
 *
 * NOT a Neo4j node: there is no AnalyticsSummary label and no repository for
 * this descriptor. It is a serialisation shape only, exactly like
 * `TokenUsageAdminSummaryDescriptor`.
 */
export type AnalyticsSummaryEntity = Entity & {
  section: string;
  window: string;
  visitors: number;
  sessions: number;
  pageViews: number;
  pagesPerSession: number;
  consentShare: number;
};

export const AnalyticsSummaryDescriptor = defineEntity<AnalyticsSummaryEntity>()({
  ...analyticsSummaryMeta,

  isCompanyScoped: false,

  fields: {
    section: { type: "string", required: true },
    window: { type: "string", required: true },
    visitors: { type: "number", required: true },
    sessions: { type: "number", required: true },
    pageViews: { type: "number", required: true },
    pagesPerSession: { type: "number", required: true },
    consentShare: { type: "number", required: true },
  },

  relationships: {},
});

export type AnalyticsSummaryDescriptorType = typeof AnalyticsSummaryDescriptor;
