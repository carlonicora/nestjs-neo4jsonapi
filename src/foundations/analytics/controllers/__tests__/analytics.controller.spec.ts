import { describe, expect, it, vi } from "vitest";

// Sibling-task modules (DTO, meta, producer service) are mocked so this spec
// exercises the controller alone.
vi.mock("../../entities/analytics-event.meta", () => ({
  analyticsEventMeta: {
    type: "analytics-events",
    endpoint: "analytics/events",
    nodeName: "analyticsEvent",
    labelName: "AnalyticsEvent",
  },
}));
vi.mock("../../dtos/analytics-event.post.dto", () => ({ AnalyticsEventPostDTO: class AnalyticsEventPostDTO {} }));
vi.mock("../../services/analytics.service", () => ({ AnalyticsService: class AnalyticsService {} }));

import { AnalyticsController } from "../analytics.controller";

function makeController() {
  const service = { track: vi.fn(async () => undefined) } as any;
  return { controller: new AnalyticsController(service), service };
}

const body = (attributes: Record<string, any> = {}) =>
  ({ data: { type: "analytics-events", attributes: { path: "/pricing", section: "public", ...attributes } } }) as any;

describe("AnalyticsController", () => {
  it("queues the page view with the first forwarded hop, the user agent and the guard's user", async () => {
    const { controller, service } = makeController();
    const request = {
      ip: "10.0.0.1",
      headers: { "x-forwarded-for": " 1.2.3.4 , 10.0.0.1", "user-agent": "UA" },
      user: { userId: "u1" },
    } as any;

    await controller.track(request, body());

    expect(service.track).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/pricing",
        section: "public",
        clientIp: "1.2.3.4",
        userAgent: "UA",
        userId: "u1",
        receivedAt: expect.any(String),
      }),
    );
  });

  it("takes the first forwarded hop", async () => {
    const { controller, service } = makeController();
    const request = { ip: "10.0.0.9", headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } } as any;

    await controller.track(request, body());

    expect(service.track.mock.calls[0][0].clientIp).toBe("1.2.3.4");
  });

  it("falls back to request.ip without the header", async () => {
    const { controller, service } = makeController();
    const request = { ip: "10.0.0.1", headers: { "user-agent": "UA" } } as any;

    await controller.track(request, body());

    expect(service.track.mock.calls[0][0].clientIp).toBe("10.0.0.1");
  });

  it("userId undefined when unauthenticated", async () => {
    const { controller, service } = makeController();
    const request = { ip: "10.0.0.1", headers: { "user-agent": "UA" } } as any;

    await controller.track(request, body());

    expect(service.track.mock.calls[0][0].userId).toBeUndefined();
  });

  it("copies every attribute from the DTO", async () => {
    const { controller, service } = makeController();
    const request = { ip: "10.0.0.1", headers: { "user-agent": "UA" } } as any;
    const attributes = {
      path: "/app/rolls",
      section: "app",
      referrer: "https://www.google.com/search?q=x",
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "launch",
      utmTerm: "film",
      utmContent: "hero",
      visitorId: "6f1c2a1e-6c0e-4b8b-9a0a-0d1f2e3c4b5a",
      screenWidth: 1280,
    };

    await controller.track(request, body(attributes));

    expect(service.track).toHaveBeenCalledWith(expect.objectContaining(attributes));
  });

  it("stamps receivedAt as an ISO instant", async () => {
    const { controller, service } = makeController();

    await controller.track({ ip: "10.0.0.1", headers: {} } as any, body());

    const { receivedAt } = service.track.mock.calls[0][0];
    expect(new Date(receivedAt).toISOString()).toBe(receivedAt);
  });
});
