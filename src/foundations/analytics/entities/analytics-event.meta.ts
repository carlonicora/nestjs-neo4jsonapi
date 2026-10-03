import { DataMeta } from "../../../common/interfaces/datamodel.interface";

/**
 * Write-only resource posted by the client tracker. There is no AnalyticsEvent
 * node and no descriptor: the meta only supplies the JSON:API `type` checked by
 * `AnalyticsEventPostDTO` and the public `endpoint` of `AnalyticsController`.
 */
export const analyticsEventMeta: DataMeta = {
  type: "analytics-events",
  endpoint: "analytics/events",
  nodeName: "analyticsEvent",
  labelName: "AnalyticsEvent",
};
