import { Entity } from "../../../common/abstracts/entity";
import { defineEntity } from "../../../common/helpers/define-entity";
import { User } from "../../user/entities/user";
import { userMeta } from "../../user/entities/user.meta";
import { analyticsSessionMeta } from "./analytics-session.meta";

/**
 * AnalyticsSession Entity Type
 *
 * One visit: consecutive page views from the same visitor id with no gap longer
 * than the session timeout. Attribution (landing route, referrer host, UTM) is
 * taken from the first page view and never overwritten.
 *
 * `visitorId` is `c:<uuid>` when it came from the consent cookie (`consented`
 * is then true) or `d:<sha256>` for the daily salted hash. Raw IP and raw user
 * agent are never stored; `deviceType` is the only user-agent derivative.
 */
export type AnalyticsSession = Entity & {
  visitorId: string;
  consented: boolean;
  startedAt: string;
  lastSeenAt: string;
  pageViews: number;
  section: string;
  landingRoute: string;
  referrerHost?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  deviceType: string;

  user?: User;
};

/**
 * AnalyticsSession Entity Descriptor
 *
 * Platform-level: no BELONGS_TO Company edge. Written by
 * `AnalyticsSessionRepository.recordPageView()` from the BullMQ worker, outside
 * HTTP/CLS context, and read only from the administration routes.
 *
 * `startedAt` / `lastSeenAt` are instants, so `type: "datetime"` — never
 * `"string"`. See references/date-handling.md rule 2.
 */
export const AnalyticsSessionDescriptor = defineEntity<AnalyticsSession>()({
  ...analyticsSessionMeta,

  isCompanyScoped: false,

  fields: {
    visitorId: { type: "string", required: true },
    consented: { type: "boolean", required: true },
    startedAt: { type: "datetime", required: true },
    lastSeenAt: { type: "datetime", required: true },
    pageViews: { type: "number", required: true },
    section: { type: "string", required: true },
    landingRoute: { type: "string", required: true },
    referrerHost: { type: "string" },
    utmSource: { type: "string" },
    utmMedium: { type: "string" },
    utmCampaign: { type: "string" },
    utmTerm: { type: "string" },
    utmContent: { type: "string" },
    deviceType: { type: "string", required: true },
  },

  relationships: {
    user: {
      model: userMeta,
      direction: "out",
      relationship: "BY_USER",
      cardinality: "one",
      required: false,
      dtoKey: "user",
    },
  },
});

export type AnalyticsSessionDescriptorType = typeof AnalyticsSessionDescriptor;
