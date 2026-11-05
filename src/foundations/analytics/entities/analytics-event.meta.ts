import { DataMeta } from "../../../common/interfaces/datamodel.interface";

/**
 * Write-only resource posted by the client tracker. There is no AnalyticsEvent
 * node and no descriptor: the meta only supplies the JSON:API `type` checked by
 * `AnalyticsEventPostDTO` and the public `endpoint` of `AnalyticsController`.
 */
export const analyticsEventMeta: DataMeta = {
  type: "analytics-events",
  // Never put words ad/tracking blocklists match in this path (analytics, event,
  // track, collect, beacon, pageview, stats, metrics, telemetry): EasyPrivacy's
  // "/analytics/event" rule silently dropped every page view from uBlock Origin users.
  endpoint: "wayfinding",
  nodeName: "analyticsEvent",
  labelName: "AnalyticsEvent",
};
