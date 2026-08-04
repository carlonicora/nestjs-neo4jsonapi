import { getQueueToken } from "@nestjs/bullmq";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { QueueId } from "../../../config/enums/queue.id";
import {
  DEFAULT_USER_ACTIVITY_CONFIG,
  USER_ACTIVITY_CONFIG,
  USER_ACTIVITY_QUEUE,
} from "../interfaces/user-activity.config.interface";
import { UserActivityRepository } from "../repositories/user-activity.repository";
import { UserActivityService } from "../services/user-activity.service";
import { UserActivityModule } from "../user-activity.module";

const providerTokens = (providers: readonly any[]) => providers.map((p) => (typeof p === "function" ? p : p.provide));

describe("UserActivityModule.forRoot", () => {
  describe("library defaults (inert)", () => {
    it("registers NO global APP_INTERCEPTOR", () => {
      const module = UserActivityModule.forRoot();

      expect(providerTokens(module.providers!)).not.toContain(APP_INTERCEPTOR);
    });

    it("registers NO global APP_INTERCEPTOR when interceptorEnabled is explicitly false", () => {
      const module = UserActivityModule.forRoot({ interceptorEnabled: false });

      expect(providerTokens(module.providers!)).not.toContain(APP_INTERCEPTOR);
    });

    it("resolves the documented defaults", () => {
      const module = UserActivityModule.forRoot();
      const config = (module.providers as any[]).find((p) => p.provide === USER_ACTIVITY_CONFIG);

      expect(config.useValue).toEqual({
        queueId: "user-activity",
        jobName: "userActivity:record",
        interceptorEnabled: false,
      });
      expect(config.useValue).toEqual(DEFAULT_USER_ACTIVITY_CONFIG);
      expect(DEFAULT_USER_ACTIVITY_CONFIG.queueId).toBe(QueueId.USER_ACTIVITY);
    });

    it("always provides the repository, the service and the queue alias", () => {
      const tokens = providerTokens(UserActivityModule.forRoot().providers!);

      expect(tokens).toContain(UserActivityRepository);
      expect(tokens).toContain(UserActivityService);
      expect(tokens).toContain(USER_ACTIVITY_CONFIG);
      expect(tokens).toContain(USER_ACTIVITY_QUEUE);
    });

    it("exports the producer surface only (no controllers, no routes)", () => {
      const module = UserActivityModule.forRoot();

      expect(module.controllers ?? []).toEqual([]);
      expect(module.exports).toEqual([UserActivityService, UserActivityRepository, USER_ACTIVITY_CONFIG]);
    });
  });

  describe("configured", () => {
    it("registers the global APP_INTERCEPTOR when interceptorEnabled is true", () => {
      const module = UserActivityModule.forRoot({ interceptorEnabled: true });

      expect(providerTokens(module.providers!)).toContain(APP_INTERCEPTOR);
    });

    it("merges partial config over the defaults", () => {
      const module = UserActivityModule.forRoot({ jobName: "app:userActivity:record", interceptorEnabled: true });
      const config = (module.providers as any[]).find((p) => p.provide === USER_ACTIVITY_CONFIG);

      expect(config.useValue).toEqual({
        queueId: "user-activity",
        jobName: "app:userActivity:record",
        interceptorEnabled: true,
      });
    });

    it("aliases the configured BullMQ queue onto USER_ACTIVITY_QUEUE", () => {
      const module = UserActivityModule.forRoot({ queueId: "custom-user-activity" });
      const alias = (module.providers as any[]).find((p) => p.provide === USER_ACTIVITY_QUEUE);

      expect(alias.useExisting).toBe(getQueueToken("custom-user-activity"));
    });
  });
});
