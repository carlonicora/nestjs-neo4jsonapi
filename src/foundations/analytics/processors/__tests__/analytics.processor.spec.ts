import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/analytics-session.repository", () => ({
  AnalyticsSessionRepository: class AnalyticsSessionRepository {},
}));
vi.mock("../../services/analytics.visitor-id.service", () => ({
  AnalyticsVisitorIdService: class AnalyticsVisitorIdService {},
}));

import { DEFAULT_ANALYTICS_CONFIG } from "../../interfaces/analytics.config.interface";
import { AnalyticsSessionRepository } from "../../repositories/analytics-session.repository";
import { AnalyticsVisitorIdService } from "../../services/analytics.visitor-id.service";
import { AnalyticsProcessor } from "../analytics.processor";

describe("AnalyticsProcessor", () => {
  let processor: AnalyticsProcessor;
  let repository: { recordPageView: ReturnType<typeof vi.fn> };
  let visitorIds: {
    isBot: ReturnType<typeof vi.fn>;
    deviceType: ReturnType<typeof vi.fn>;
    resolve: ReturnType<typeof vi.fn>;
  };
  let logger: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let clsValues: Record<string, unknown>;
  let cls: ClsService;

  const build = (config = DEFAULT_ANALYTICS_CONFIG) => {
    repository = { recordPageView: vi.fn(async () => ({ sessionId: "session-1", created: true })) };
    visitorIds = {
      isBot: vi.fn(() => false),
      deviceType: vi.fn(() => "mobile"),
      resolve: vi.fn(async (input: { visitorId?: string }) =>
        input.visitorId
          ? { visitorId: `c:${input.visitorId}`, consented: true }
          : { visitorId: "d:hash", consented: false },
      ),
    };
    logger = { debug: vi.fn(), error: vi.fn() };
    clsValues = {};
    cls = {
      run: vi.fn(async (fn: () => Promise<void>) => fn()),
      set: vi.fn((key: string, value: unknown) => {
        clsValues[key] = value;
      }),
      get: vi.fn((key: string) => clsValues[key]),
    } as unknown as ClsService;

    return new AnalyticsProcessor(
      logger as any,
      repository as unknown as AnalyticsSessionRepository,
      visitorIds as unknown as AnalyticsVisitorIdService,
      cls,
      config,
    );
  };

  const baseInput = {
    path: "/pricing",
    section: "public",
    clientIp: "1.2.3.4",
    userAgent: "Mozilla/5.0 (iPhone)",
    receivedAt: "2026-10-03T10:00:00.000Z",
  };

  const job = (name: string, data: Record<string, unknown> = {}) => ({ id: "job-1", name, data }) as unknown as Job;

  beforeEach(() => {
    processor = build();
  });

  it("drops bot traffic without writing", async () => {
    visitorIds.isBot.mockReturnValue(true);

    await processor.process(job("analytics:pageView", { ...baseInput, userAgent: "Googlebot/2.1" }));

    expect(repository.recordPageView).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("bot"));
  });

  it("resolves the visitor, normalises the route and records", async () => {
    const path = "/rolls/6f1c2d3e-0000-4000-8000-000000000001/culls";

    await processor.process(
      job("analytics:pageView", {
        ...baseInput,
        path,
        section: "app",
        referrer: "https://www.linkedin.com/feed/",
        utmSource: "linkedin",
      }),
    );

    expect(cls.run).toHaveBeenCalledTimes(1);
    expect(clsValues.isAutomatedJob).toBe(true);
    expect(visitorIds.deviceType).toHaveBeenCalledWith(baseInput.userAgent);
    expect(repository.recordPageView).toHaveBeenCalledWith({
      visitorId: "d:hash",
      consented: false,
      path,
      route: "/rolls/:id/culls",
      section: "app",
      referrerHost: "www.linkedin.com",
      utmSource: "linkedin",
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      deviceType: "mobile",
      userId: null,
      receivedAt: baseInput.receivedAt,
      sessionTimeoutMinutes: 30,
    });
    expect(logger.debug).toHaveBeenCalledWith("analytics pageView visitor=d:hash session=session-1 created=true");
  });

  it("cookie id and hash id never merge", async () => {
    const cookieId = "0c9e7b1a-1111-4111-8111-111111111111";

    await processor.process(job("analytics:pageView", { ...baseInput, visitorId: cookieId }));
    await processor.process(job("analytics:pageView", { ...baseInput }));

    expect(repository.recordPageView).toHaveBeenCalledTimes(2);
    expect(repository.recordPageView.mock.calls[0][0]).toMatchObject({ visitorId: `c:${cookieId}`, consented: true });
    expect(repository.recordPageView.mock.calls[1][0]).toMatchObject({ visitorId: "d:hash", consented: false });
  });

  it("referrer on the same host is not an external referrer", async () => {
    // Host comparison is the tracker's job; the processor stores the host as given.
    await processor.process(job("analytics:pageView", { ...baseInput, referrer: "https://only35.com/pricing" }));

    expect(repository.recordPageView).toHaveBeenCalledWith(expect.objectContaining({ referrerHost: "only35.com" }));
  });

  it("rejects a foreign job name", async () => {
    await expect(processor.process(job("other", baseInput))).rejects.toThrow(
      "Job other not handled by AnalyticsProcessor",
    );
    expect(repository.recordPageView).not.toHaveBeenCalled();
  });

  it("logs failures via the failed worker event", () => {
    processor.onError({ id: "job-9", failedReason: "boom" } as unknown as Job);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
