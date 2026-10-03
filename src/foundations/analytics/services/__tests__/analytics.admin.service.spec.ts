import { NotFoundException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

// Sibling-task modules (descriptors, repositories, config) are mocked so this
// spec exercises the service alone. Each descriptor model is a sentinel object
// so the assertions can tell which model buildList received.
const models = vi.hoisted(() => ({
  session: { type: "analytics-sessions" },
  pageView: { type: "analytics-pageviews" },
  summary: { type: "analytics-summaries" },
  timeline: { type: "analytics-timelines" },
  breakdown: { type: "analytics-breakdowns" },
}));

vi.mock("../../entities/analytics-session", () => ({
  AnalyticsSessionDescriptor: { model: models.session, relationships: {} },
}));
vi.mock("../../entities/analytics-page-view", () => ({
  AnalyticsPageViewDescriptor: { model: models.pageView, relationships: {} },
}));
vi.mock("../../entities/analytics-summary", () => ({
  AnalyticsSummaryDescriptor: { model: models.summary, relationships: {} },
}));
vi.mock("../../entities/analytics-timeline", () => ({
  AnalyticsTimelineDescriptor: { model: models.timeline, relationships: {} },
}));
vi.mock("../../entities/analytics-breakdown", () => ({
  AnalyticsBreakdownDescriptor: { model: models.breakdown, relationships: {} },
}));
vi.mock("../../repositories/analytics-session.repository", () => ({
  AnalyticsSessionRepository: class AnalyticsSessionRepository {},
}));
vi.mock("../../repositories/analytics-page-view.repository", () => ({
  AnalyticsPageViewRepository: class AnalyticsPageViewRepository {},
}));
vi.mock("../../repositories/analytics.admin.repository", () => ({
  AnalyticsAdminRepository: class AnalyticsAdminRepository {},
}));
vi.mock("../../interfaces/analytics.config.interface", () => ({
  ANALYTICS_CONFIG: Symbol("ANALYTICS_CONFIG"),
}));

import { JsonApiPaginator } from "../../../../core/jsonapi/serialisers/jsonapi.paginator";
import { AnalyticsAdminService } from "../analytics.admin.service";

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-08-07T00:00:00.000Z";

function makeService(
  overrides: { admin?: Record<string, any>; session?: Record<string, any>; pageView?: Record<string, any> } = {},
  retentionMonths = 13,
) {
  const jsonApiService = {
    buildList: vi.fn(async (model: any, rows: any[], paginator?: any) => ({ model, rows, paginator })),
    buildSingle: vi.fn(async (model: any, row: any) => ({ model, row })),
  } as any;
  const adminRepository = {
    findSummary: vi.fn(async () => []),
    findTimeline: vi.fn(async () => []),
    findBreakdown: vi.fn(async () => []),
    ...overrides.admin,
  } as any;
  const sessionRepository = {
    findForAdmin: vi.fn(async () => []),
    findById: vi.fn(async ({ id }: { id: string }) => ({ id })),
    ...overrides.session,
  } as any;
  const pageViewRepository = {
    findBySession: vi.fn(async () => []),
    ...overrides.pageView,
  } as any;
  const clsService = { get: vi.fn(() => undefined), has: vi.fn(() => false) } as any;
  const config = {
    enabled: true,
    retentionMonths,
    sessionTimeoutMinutes: 30,
    queueId: "analytics",
    jobName: "analytics:pageView",
  };

  const service = new AnalyticsAdminService(
    jsonApiService,
    sessionRepository,
    clsService,
    adminRepository,
    pageViewRepository,
    config,
  );
  return { service, jsonApiService, adminRepository, sessionRepository, pageViewRepository };
}

describe("AnalyticsAdminService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("inherits the generic CRUD surface from AbstractService", () => {
    const { service } = makeService();
    expect(typeof (service as any).find).toBe("function");
    expect(typeof (service as any).findById).toBe("function");
  });

  it("serialises the summary as a JSON:API list with the summary model", async () => {
    const rows = [{ id: "total|current" }];
    const { service, jsonApiService, adminRepository } = makeService({
      admin: { findSummary: vi.fn(async () => rows) },
    });

    await service.getSummary({ from: FROM, to: TO, section: "all" });

    expect(adminRepository.findSummary).toHaveBeenCalledWith({
      from: FROM,
      to: TO,
      section: "all",
      retentionCutoff: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(jsonApiService.buildList).toHaveBeenCalledWith(models.summary, rows);
  });

  it("serialises the timeline with the timeline model", async () => {
    const rows = [{ id: "2026-08-01|all" }];
    const { service, jsonApiService, adminRepository } = makeService({
      admin: { findTimeline: vi.fn(async () => rows) },
    });

    await service.getTimeline({ from: FROM, to: TO, section: "public", granularity: "week" });

    expect(adminRepository.findTimeline).toHaveBeenCalledWith({
      from: FROM,
      to: TO,
      section: "public",
      granularity: "week",
      retentionCutoff: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(jsonApiService.buildList).toHaveBeenCalledWith(models.timeline, rows);
  });

  it("passes the breakdown dimension, section and limit straight through", async () => {
    const { service, jsonApiService, adminRepository } = makeService();

    await service.getBreakdown({ from: FROM, to: TO, section: "app", dimension: "campaign", limit: 20 });

    expect(adminRepository.findBreakdown).toHaveBeenCalledWith({
      from: FROM,
      to: TO,
      section: "app",
      dimension: "campaign",
      limit: 20,
      retentionCutoff: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(jsonApiService.buildList).toHaveBeenCalledWith(models.breakdown, []);
  });

  it("builds the sessions list with a paginator and its cursor", async () => {
    const rows = [{ id: "s1" }];
    const { service, jsonApiService, sessionRepository } = makeService({
      session: { findForAdmin: vi.fn(async () => rows) },
    });
    const generateCursor = vi.spyOn(JsonApiPaginator.prototype, "generateCursor");

    await service.getSessions({
      query: { "page[size]": "10" },
      from: FROM,
      to: TO,
      section: "all",
      visitorId: "c:abc",
      userId: "u1",
    });

    expect(generateCursor).toHaveBeenCalled();
    const cursor = generateCursor.mock.results[0].value;
    expect(sessionRepository.findForAdmin).toHaveBeenCalledWith({
      cursor,
      from: FROM,
      to: TO,
      section: "all",
      visitorId: "c:abc",
      userId: "u1",
    });
    const [model, passedRows, paginator] = jsonApiService.buildList.mock.calls[0];
    expect(model).toBe(models.session);
    expect(passedRows).toBe(rows);
    expect(paginator).toBeInstanceOf(JsonApiPaginator);

    generateCursor.mockRestore();
  });

  it("findById serialises one session as a single JSON:API document with the session model", async () => {
    const row = { id: "s1", user: { id: "u1" } };
    const { service, jsonApiService, sessionRepository } = makeService({
      session: { findById: vi.fn(async () => row) },
    });

    const response = await service.findById({ id: "s1" });

    expect(sessionRepository.findById).toHaveBeenCalledWith({ id: "s1" });
    expect(jsonApiService.buildSingle).toHaveBeenCalledWith(models.session, row);
    expect(response).toEqual({ model: models.session, row });
  });

  it("lists a session's page views with the page-view model", async () => {
    const rows = [{ id: "pv1" }, { id: "pv2" }];
    const { service, jsonApiService, sessionRepository, pageViewRepository } = makeService({
      pageView: { findBySession: vi.fn(async () => rows) },
    });

    await service.getSessionPageViews({ sessionId: "s1" });

    expect(sessionRepository.findById).toHaveBeenCalledWith({ id: "s1" });
    expect(pageViewRepository.findBySession).toHaveBeenCalledWith({ sessionId: "s1" });
    expect(jsonApiService.buildList).toHaveBeenCalledWith(models.pageView, rows);
  });

  it("getSessionPageViews throws NotFoundException when findById does", async () => {
    const { service, pageViewRepository, jsonApiService } = makeService({
      session: {
        findById: vi.fn(async () => {
          throw new NotFoundException();
        }),
      },
    });

    await expect(service.getSessionPageViews({ sessionId: "missing" })).rejects.toThrow(NotFoundException);
    expect(pageViewRepository.findBySession).not.toHaveBeenCalled();
    expect(jsonApiService.buildList).not.toHaveBeenCalled();
  });

  it("retentionCutoff() returns YYYY-MM-DD 13 months before today for the default config", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00.000Z"));
    const { service } = makeService();

    expect(service.retentionCutoff()).toBe("2025-09-03");
  });

  it("retentionCutoff() clamps the day to the target month's length", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T08:00:00.000Z"));
    const { service } = makeService({}, 1);

    expect(service.retentionCutoff()).toBe("2026-02-28");
  });
});
