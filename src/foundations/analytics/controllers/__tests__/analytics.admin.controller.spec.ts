import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

// Sibling-task modules (metas, admin service) are mocked so this spec exercises
// the controller alone.
vi.mock("../../entities/analytics-summary.meta", () => ({
  analyticsSummaryMeta: { endpoint: "analytics/administration/summary" },
}));
vi.mock("../../entities/analytics-timeline.meta", () => ({
  analyticsTimelineMeta: { endpoint: "analytics/administration/timeline" },
}));
vi.mock("../../entities/analytics-breakdown.meta", () => ({
  analyticsBreakdownMeta: { endpoint: "analytics/administration/breakdown" },
}));
vi.mock("../../entities/analytics-session.meta", () => ({
  analyticsSessionMeta: { endpoint: "analytics/administration/sessions" },
}));
vi.mock("../../entities/analytics-page-view.meta", () => ({
  analyticsPageViewMeta: { endpoint: "pageviews" },
}));
vi.mock("../../services/analytics.admin.service", () => ({
  AnalyticsAdminService: class AnalyticsAdminService {},
}));

import { AnalyticsAdminController } from "../analytics.admin.controller";

const reply = () => ({ send: vi.fn() }) as any;

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-08-07T00:00:00.000Z";

function makeController() {
  const service = {
    getSummary: vi.fn(async () => ({ data: [] })),
    getTimeline: vi.fn(async () => ({ data: [] })),
    getBreakdown: vi.fn(async () => ({ data: [] })),
    getSessions: vi.fn(async () => ({ data: [] })),
    getSessionPageViews: vi.fn(async () => ({ data: [] })),
    findById: vi.fn(async ({ id }: { id: string }) => ({ data: { id } })),
  } as any;
  const auditService = { logRead: vi.fn() } as any;
  return { controller: new AnalyticsAdminController(service, auditService), service, auditService };
}

describe("AnalyticsAdminController", () => {
  it("defaults the breakdown limit to 20 and the section to all", async () => {
    const { controller, service } = makeController();
    const r = reply();

    await controller.getBreakdown(r, FROM, TO, undefined, "source");

    expect(service.getBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: "source", section: "all", limit: 20 }),
    );
    expect(r.send).toHaveBeenCalled();
  });

  it("defaults the timeline granularity to day and the section to all", async () => {
    const { controller, service } = makeController();

    await controller.getTimeline(reply(), FROM, TO);

    expect(service.getTimeline).toHaveBeenCalledWith(expect.objectContaining({ granularity: "day", section: "all" }));
  });

  it("rejects an unknown granularity rather than interpolating it into Cypher", async () => {
    const { controller, service } = makeController();

    await expect(
      controller.getTimeline(reply(), FROM, TO, undefined, "'; MATCH (n) DETACH DELETE n //"),
    ).rejects.toThrow();
    expect(service.getTimeline).not.toHaveBeenCalled();
  });

  it("defaults section to all, granularity to day, limit to 20", async () => {
    const { controller, service } = makeController();

    await controller.getSummary(reply(), FROM, TO);
    await controller.getTimeline(reply(), FROM, TO);
    await controller.getBreakdown(reply(), FROM, TO);

    expect(service.getSummary).toHaveBeenCalledWith({ from: FROM, to: TO, section: "all" });
    expect(service.getTimeline).toHaveBeenCalledWith({ from: FROM, to: TO, section: "all", granularity: "day" });
    expect(service.getBreakdown).toHaveBeenCalledWith(expect.objectContaining({ section: "all", limit: 20 }));
  });

  it("defaults the range to the last 30 days", async () => {
    const { controller, service } = makeController();

    await controller.getSummary(reply(), undefined, TO);

    expect(service.getSummary).toHaveBeenCalledWith({ from: "2026-07-08T00:00:00.000Z", to: TO, section: "all" });
  });

  it("rejects limit 0 and 101", async () => {
    const { controller, service } = makeController();

    await expect(controller.getBreakdown(reply(), FROM, TO, undefined, "source", "0")).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.getBreakdown(reply(), FROM, TO, undefined, "source", "101")).rejects.toThrow(
      BadRequestException,
    );
    expect(service.getBreakdown).not.toHaveBeenCalled();
  });

  it("accepts limit 100", async () => {
    const { controller, service } = makeController();

    await controller.getBreakdown(reply(), FROM, TO, undefined, "route", "100");

    expect(service.getBreakdown).toHaveBeenCalledWith(expect.objectContaining({ dimension: "route", limit: 100 }));
  });

  it("rejects dimension outside the six", async () => {
    const { controller, service } = makeController();

    for (const dimension of ["source", "medium", "campaign", "referrer", "route", "landing"])
      await controller.getBreakdown(reply(), FROM, TO, undefined, dimension);
    expect(service.getBreakdown).toHaveBeenCalledTimes(6);

    await expect(controller.getBreakdown(reply(), FROM, TO, undefined, "company")).rejects.toThrow(BadRequestException);
    expect(service.getBreakdown).toHaveBeenCalledTimes(6);
  });

  it("rejects an unknown section", async () => {
    const { controller, service } = makeController();

    await expect(controller.getSummary(reply(), FROM, TO, "admin")).rejects.toThrow(BadRequestException);
    expect(service.getSummary).not.toHaveBeenCalled();
  });

  it("rejects a range longer than 400 days with 400", async () => {
    const { controller, service } = makeController();

    const error = await controller
      .getSummary(reply(), "2025-01-01T00:00:00.000Z", "2026-02-06T00:00:00.000Z")
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(service.getSummary).not.toHaveBeenCalled();
  });

  it("accepts a range of exactly 400 days", async () => {
    const { controller, service } = makeController();

    await controller.getSummary(reply(), "2025-01-01T00:00:00.000Z", "2026-02-05T00:00:00.000Z");

    expect(service.getSummary).toHaveBeenCalled();
  });

  it("sessions passes query, section, visitorId, userId through", async () => {
    const { controller, service } = makeController();
    const query = { "page[size]": "25" };
    const r = reply();

    await controller.getSessions(r, query, FROM, TO, "public", "d:abc", "u1");

    expect(service.getSessions).toHaveBeenCalledWith({
      query,
      from: FROM,
      to: TO,
      section: "public",
      visitorId: "d:abc",
      userId: "u1",
    });
    expect(r.send).toHaveBeenCalled();
  });

  it("getSession sends the service's single response for the id", async () => {
    const { controller, service } = makeController();
    const r = reply();

    await controller.getSession(r, "session-1");

    expect(service.findById).toHaveBeenCalledWith({ id: "session-1" });
    expect(r.send).toHaveBeenCalledWith({ data: { id: "session-1" } });
  });

  it("pageviews calls getSessionPageViews with the id", async () => {
    const { controller, service } = makeController();
    const r = reply();

    await controller.getSessionPageViews(r, "session-1");

    expect(service.getSessionPageViews).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(r.send).toHaveBeenCalledWith({ data: [] });
  });
});
