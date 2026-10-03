import { describe, expect, it } from "vitest";
import { AnalyticsSessionDescriptor } from "../analytics-session";
import { AnalyticsPageViewDescriptor } from "../analytics-page-view";
import { AnalyticsDailySummaryDescriptor } from "../analytics-daily-summary";
import { AnalyticsTimelineDescriptor } from "../analytics-timeline";

describe("analytics descriptors", () => {
  it("are platform-level, never company scoped", () => {
    for (const d of [
      AnalyticsSessionDescriptor,
      AnalyticsPageViewDescriptor,
      AnalyticsDailySummaryDescriptor,
      AnalyticsTimelineDescriptor,
    ])
      expect(d.isCompanyScoped).toBe(false);
  });
  it("stores instants as datetime and calendar days as date", () => {
    expect(AnalyticsSessionDescriptor.fields.startedAt.type).toBe("datetime");
    expect(AnalyticsSessionDescriptor.fields.lastSeenAt.type).toBe("datetime");
    expect(AnalyticsDailySummaryDescriptor.fields.date.type).toBe("date");
    expect(AnalyticsTimelineDescriptor.fields.bucket.type).toBe("date");
  });
  it("links a session to its user through BY_USER and a page view to its session through IN_SESSION", () => {
    expect(AnalyticsSessionDescriptor.relationships.user).toMatchObject({
      direction: "out",
      relationship: "BY_USER",
      cardinality: "one",
      required: false,
    });
    expect(AnalyticsPageViewDescriptor.relationships.session).toMatchObject({
      direction: "out",
      relationship: "IN_SESSION",
      cardinality: "one",
      required: true,
    });
  });
  it("uses the agreed JSON:API types", () => {
    expect(AnalyticsSessionDescriptor.model.type).toBe("analytics-sessions");
    expect(AnalyticsTimelineDescriptor.model.endpoint).toBe("analytics/administration/timeline");
  });
});
