import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";

vi.mock("../../repositories/analytics-session.repository", () => ({
  AnalyticsSessionRepository: class AnalyticsSessionRepository {},
}));
vi.mock("../../entities/analytics-session", () => ({
  AnalyticsSessionDescriptor: { model: { type: "analytics-sessions" }, relationships: {} },
}));

import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { DEFAULT_ANALYTICS_CONFIG } from "../../interfaces/analytics.config.interface";
import { AnalyticsPageViewInput } from "../../interfaces/analytics.page-view.input";
import { AnalyticsSessionRepository } from "../../repositories/analytics-session.repository";
import { AnalyticsService } from "../analytics.service";

describe("AnalyticsService", () => {
  let service: AnalyticsService;
  let queue: { add: ReturnType<typeof vi.fn> };
  let logger: Mocked<Pick<AppLoggingService, "error" | "debug">>;

  const input: AnalyticsPageViewInput = {
    path: "/pricing",
    section: "public",
    clientIp: "1.2.3.4",
    userAgent: "Mozilla/5.0",
    receivedAt: "2026-10-03T10:00:00.000Z",
  };

  const build = (config = DEFAULT_ANALYTICS_CONFIG) => {
    queue = { add: vi.fn(async () => undefined) };
    logger = { error: vi.fn(), debug: vi.fn() };

    return new AnalyticsService(
      {} as any,
      {} as unknown as AnalyticsSessionRepository,
      { get: vi.fn(), set: vi.fn() } as unknown as ClsService,
      queue as unknown as Queue,
      // The service only calls error/debug; the full logging class is not needed.
      logger as unknown as AppLoggingService,
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

    describe("exclusions", () => {
      beforeEach(() => {
        service = build({ ...DEFAULT_ANALYTICS_CONFIG, excludedRoleIds: ["role-x"], excludedUserIds: ["user-x"] });
      });

      it("drops an app page view from an excluded user", async () => {
        await service.track({ ...input, section: "app", userId: "user-x" });

        expect(queue.add).not.toHaveBeenCalled();
      });

      it("counts a public page view from an excluded user as anonymous", async () => {
        await service.track({ ...input, userId: "user-x" });

        expect(queue.add).toHaveBeenCalledWith("analytics:pageView", input);
        expect(queue.add.mock.calls[0][1]).not.toHaveProperty("userId");
      });

      it("drops a public page view when a role is excluded, even for an excluded user", async () => {
        await service.track({ ...input, userId: "user-x" }, { roles: ["role-x"] });

        expect(queue.add).not.toHaveBeenCalledWith("analytics:pageView", expect.anything());
      });

      it("drops a page view when any role is excluded", async () => {
        await service.track({ ...input, userId: "u1" }, { roles: ["role-a", "role-x"] });

        expect(queue.add).not.toHaveBeenCalledWith("analytics:pageView", expect.anything());
        const message = logger.debug.mock.calls[0][0] as string;
        expect(message).toContain("/pricing");
        expect(message).not.toContain("1.2.3.4");
        expect(message).not.toContain("Mozilla");
      });

      it("queues a visitor purge instead of the page view when a role is excluded", async () => {
        await service.track({ ...input, userId: "u1", visitorId: "cookie-1" }, { roles: ["role-x"] });

        expect(queue.add).toHaveBeenCalledTimes(1);
        expect(queue.add).toHaveBeenCalledWith("analytics:pageView:purgeVisitor", {
          visitorId: "cookie-1",
          clientIp: input.clientIp,
          userAgent: input.userAgent,
          receivedAt: input.receivedAt,
        });
      });

      it("does not purge the visitor for an excluded user", async () => {
        await service.track({ ...input, section: "app", userId: "user-x" });
        await service.track({ ...input, userId: "user-x" });

        expect(queue.add).not.toHaveBeenCalledWith("analytics:pageView:purgeVisitor", expect.anything());
      });

      it("queues an anonymous page view", async () => {
        await service.track(input);

        expect(queue.add).toHaveBeenCalledWith("analytics:pageView", input);
      });

      it("queues a non-excluded user without adding roles to the job", async () => {
        await service.track({ ...input, userId: "u1" }, { roles: ["role-a"] });

        expect(queue.add).toHaveBeenCalledWith("analytics:pageView", { ...input, userId: "u1" });
      });
    });
  });
});
