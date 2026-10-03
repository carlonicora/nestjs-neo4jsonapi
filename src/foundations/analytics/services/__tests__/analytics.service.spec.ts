import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/analytics-session.repository", () => ({
  AnalyticsSessionRepository: class AnalyticsSessionRepository {},
}));
vi.mock("../../entities/analytics-session", () => ({
  AnalyticsSessionDescriptor: { model: { type: "analytics-sessions" }, relationships: {} },
}));

import { DEFAULT_ANALYTICS_CONFIG } from "../../interfaces/analytics.config.interface";
import { AnalyticsPageViewInput } from "../../interfaces/analytics.page-view.input";
import { AnalyticsSessionRepository } from "../../repositories/analytics-session.repository";
import { AnalyticsService } from "../analytics.service";

describe("AnalyticsService", () => {
  let service: AnalyticsService;
  let queue: { add: ReturnType<typeof vi.fn> };
  let logger: { error: ReturnType<typeof vi.fn> };

  const input: AnalyticsPageViewInput = {
    path: "/pricing",
    section: "public",
    clientIp: "1.2.3.4",
    userAgent: "Mozilla/5.0",
    receivedAt: "2026-10-03T10:00:00.000Z",
  };

  const build = (config = DEFAULT_ANALYTICS_CONFIG) => {
    queue = { add: vi.fn(async () => undefined) };
    logger = { error: vi.fn() };

    return new AnalyticsService(
      {} as any,
      {} as unknown as AnalyticsSessionRepository,
      { get: vi.fn(), set: vi.fn() } as unknown as ClsService,
      queue as unknown as Queue,
      logger as any,
      config,
    );
  };

  beforeEach(() => {
    service = build();
  });

  describe("track", () => {
    it("enqueues the input under the configured job name", async () => {
      await service.track(input);

      expect(queue.add).toHaveBeenCalledWith("analytics:pageView", input);
    });

    it("honours a caller-supplied job name", async () => {
      service = build({ ...DEFAULT_ANALYTICS_CONFIG, jobName: "app:analytics:pageView" });

      await service.track(input);

      expect(queue.add).toHaveBeenCalledWith("app:analytics:pageView", input);
    });

    it("NEVER throws when the enqueue fails — analytics must not break the request path", async () => {
      queue.add.mockRejectedValueOnce(new Error("redis is down"));

      await expect(service.track(input)).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("redis is down"));
    });
  });
});
