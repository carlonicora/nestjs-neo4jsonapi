import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { AnalyticsSession } from "./analytics-session";
import { analyticsPageViewMeta } from "./analytics-page-view.meta";
import { analyticsSessionMeta } from "./analytics-session.meta";

/**
 * AnalyticsPageView Entity Type
 *
 * One route change inside a session. `path` is the pathname as visited (no
 * query string, no hash); `route` is `path` with UUID segments replaced by
 * `:id`, so pages can be grouped.
 */
export type AnalyticsPageView = Entity & {
  createdAt: string;
  path: string;
  route: string;
  section: string;

  session?: AnalyticsSession;
};

/**
 * AnalyticsPageView Entity Descriptor
 *
 * Platform-level: no BELONGS_TO Company edge. The graph shape is
 * `(analyticsPageView)-[:IN_SESSION]->(analyticsSession)`. The resource is only
 * served nested under a session:
 * `${analyticsSessionMeta.endpoint}/:sessionId/${analyticsPageViewMeta.endpoint}`.
 *
 * `createdAt` is an instant, so `type: "datetime"`. See
 * references/date-handling.md rule 2.
 */
export const AnalyticsPageViewDescriptor = defineEntity<AnalyticsPageView>()({
  ...analyticsPageViewMeta,

  isCompanyScoped: false,

  fields: {
    createdAt: { type: "datetime", required: true },
    path: { type: "string", required: true },
    route: { type: "string", required: true },
    section: { type: "string", required: true },
  },

  relationships: {
    session: {
      model: analyticsSessionMeta,
      direction: "out",
      relationship: "IN_SESSION",
      cardinality: "one",
      required: true,
      dtoKey: "session",
    },
  },
});

export type AnalyticsPageViewDescriptorType = typeof AnalyticsPageViewDescriptor;
