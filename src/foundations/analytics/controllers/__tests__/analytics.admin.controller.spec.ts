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
  it("defaults the breakdown limit to 20 and the audience to visitors", async () => {
    const { controller, service } = makeController();
    const r = reply();

    await controller.getBreakdown(r, FROM, TO, undefined, "source");

    expect(service.getBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: "source", audience: "visitors", limit: 20 }),
    );
    expect(r.send).toHaveBeenCalled();
  });

  it("defaults the timeline granularity to day and the audience to visitors", async () => {
    const { controller, service } = makeController();

    await controller.getTimeline(reply(), FROM, TO);

    expect(service.getTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ granularity: "day", audience: "visitors" }),
    );
  });

  it("rejects an unknown granularity rather than interpolating it into Cypher", async () => {
    const { controller, service } = makeController();

    await expect(
      controller.getTimeline(reply(), FROM, TO, undefined, "'; MATCH (n) DETACH DELETE n //"),
    ).rejects.toThrow();
    expect(service.getTimeline).not.toHaveBeenCalled();
  });

  it("defaults audience to visitors, granularity to day, limit to 20", async () => {
    const { controller, service } = makeController();

    await controller.getSummary(reply(), FROM, TO);
    await controller.getTimeline(reply(), FROM, TO);
    await controller.getBreakdown(reply(), FROM, TO);

    expect(service.getSummary).toHaveBeenCalledWith({ from: FROM, to: TO, audience: "visitors" });
    expect(service.getTimeline).toHaveBeenCalledWith({ from: FROM, to: TO, audience: "visitors", granularity: "day" });
    expect(service.getBreakdown).toHaveBeenCalledWith(expect.objectContaining({ audience: "visitors", limit: 20 }));
  });

  it("defaults the range to the last 30 days", async () => {
    const { controller, service } = makeController();

    await controller.getSummary(reply(), undefined, TO);

    expect(service.getSummary).toHaveBeenCalledWith({ from: "2026-07-08T00:00:00.000Z", to: TO, audience: "visitors" });
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

  it("rejects dimension outside the seven", async () => {
    const { controller, service } = makeController();

    for (const dimension of ["source", "medium", "campaign", "referrer", "route", "landing", "exit"])
      await controller.getBreakdown(reply(), FROM, TO, undefined, dimension);
    expect(service.getBreakdown).toHaveBeenCalledTimes(7);

    await expect(controller.getBreakdown(reply(), FROM, TO, undefined, "company")).rejects.toThrow(BadRequestException);
    expect(service.getBreakdown).toHaveBeenCalledTimes(7);
  });

  it("breakdown accepts exit", async () => {
    const { controller, service } = makeController();

    await controller.getBreakdown(reply(), FROM, TO, "visitors", "exit", "10");

    expect(service.getBreakdown).toHaveBeenCalledWith({
      from: FROM,
      to: TO,
      audience: "visitors",
      dimension: "exit",
      limit: 10,
    });
  });

  it("defaults audience to visitors on each of the four list routes", async () => {
    const { controller, service } = makeController();

    await controller.getSummary(reply(), FROM, TO);
    await controller.getTimeline(reply(), FROM, TO);
    await controller.getBreakdown(reply(), FROM, TO);
    await controller.getSessions(reply(), {}, FROM, TO);

    for (const fn of [service.getSummary, service.getTimeline, service.getBreakdown, service.getSessions])
      expect(fn.mock.calls[0][0].audience).toBe("visitors");
  });

  it("passes audience=users through on each of the four list routes", async () => {
    const { controller, service } = makeController();

    await controller.getSummary(reply(), FROM, TO, "users");
    await controller.getTimeline(reply(), FROM, TO, "users");
    await controller.getBreakdown(reply(), FROM, TO, "users");
    await controller.getSessions(reply(), {}, FROM, TO, "users");

    for (const fn of [service.getSummary, service.getTimeline, service.getBreakdown, service.getSessions])
      expect(fn.mock.calls[0][0].audience).toBe("users");
  });

  it("rejects an unknown audience with 400", async () => {
    const { controller, service } = makeController();

    for (const call of [
      () => controller.getSummary(reply(), FROM, TO, "all"),
      () => controller.getTimeline(reply(), FROM, TO, "all"),
      () => controller.getBreakdown(reply(), FROM, TO, "all"),
      () => controller.getSessions(reply(), {}, FROM, TO, "all"),
    ]) {
      const error = await call().catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getStatus()).toBe(400);
    }
    expect(service.getSummary).not.toHaveBeenCalled();
    expect(service.getTimeline).not.toHaveBeenCalled();
    expect(service.getBreakdown).not.toHaveBeenCalled();
    expect(service.getSessions).not.toHaveBeenCalled();
  });

  it("ignores a section param", async () => {
    const { controller, service } = makeController();
    // A section param from an old client reaches only the raw query object
    // used for pagination; no route reads it.
    const query = { section: "app" };

    await controller.getSessions(reply(), query, FROM, TO, undefined);

    const params = service.getSessions.mock.calls[0][0];
    expect(params.audience).toBe("visitors");
    expect(params).not.toHaveProperty("section");
    expect(controller.getSummary.length).toBe(4);
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

  it("sessions passes query, audience, visitorId, userId through", async () => {
    const { controller, service } = makeController();
    const query = { "page[size]": "25" };
    const r = reply();

    await controller.getSessions(r, query, FROM, TO, "users", "d:abc", "u1");

    expect(service.getSessions).toHaveBeenCalledWith({
      query,
      from: FROM,
      to: TO,
      audience: "users",
      visitorId: "d:abc",
      userId: "u1",
    });
    expect(r.send).toHaveBeenCalled();
  });

  it("getSession sends the service's single response for the id", async () => {
    const { controller, service } = makeController();
    const r = reply();

    await controller.getSession({ params: { sessionId: "session-1" } } as any, r, "session-1");

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
