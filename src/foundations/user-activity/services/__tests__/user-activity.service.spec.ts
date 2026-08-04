import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_ACTIVITY_CONFIG } from "../../interfaces/user-activity.config.interface";
import { UserActivityRepository } from "../../repositories/user-activity.repository";
import { UserActivityService } from "../user-activity.service";

describe("UserActivityService", () => {
  let service: UserActivityService;
  let queue: { add: ReturnType<typeof vi.fn> };
  let logger: { error: ReturnType<typeof vi.fn> };
  let repository: { findByUser: ReturnType<typeof vi.fn> };

  const build = (config = DEFAULT_USER_ACTIVITY_CONFIG) => {
    queue = { add: vi.fn(async () => undefined) };
    logger = { error: vi.fn() };
    repository = { findByUser: vi.fn(async () => []) };

    return new UserActivityService(
      {} as any,
      repository as unknown as UserActivityRepository,
      { get: vi.fn(), set: vi.fn() } as unknown as ClsService,
      queue as unknown as Queue,
      logger as any,
      config,
    );
  };

  beforeEach(() => {
    service = build();
  });

  describe("record", () => {
    it("enqueues the input under the configured job name", async () => {
      const input = {
        userId: "user-1",
        companyId: "company-1",
        category: "ENTITY",
        action: "CREATE",
      };

      await service.record(input);

      expect(queue.add).toHaveBeenCalledWith("userActivity:record", input);
    });

    it("honours a caller-supplied job name", async () => {
      service = build({ ...DEFAULT_USER_ACTIVITY_CONFIG, jobName: "app:userActivity:record" });

      await service.record({ userId: "u", companyId: "c", category: "AUTH", action: "LOGIN" });

      expect(queue.add).toHaveBeenCalledWith("app:userActivity:record", expect.anything());
    });

    it("NEVER throws when the enqueue fails — the activity log must not break the request path", async () => {
      queue.add.mockRejectedValueOnce(new Error("redis is down"));

      await expect(
        service.record({ userId: "u", companyId: "c", category: "AUTH", action: "LOGIN" }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("redis is down"));
    });

    it("accepts open string category/action so app enums stay assignable", async () => {
      // The library widened UserActivityRecordInput.category/action to `string`;
      // a consuming app's string-enum members satisfy it unchanged.
      enum AppCategory {
        DOCUMENT = "DOCUMENT",
      }
      enum AppAction {
        SHARE = "SHARE",
      }

      await service.record({
        userId: "u",
        companyId: "c",
        category: AppCategory.DOCUMENT,
        action: AppAction.SHARE,
      });

      expect(queue.add).toHaveBeenCalledWith(
        "userActivity:record",
        expect.objectContaining({ category: "DOCUMENT", action: "SHARE" }),
      );
    });
  });

  describe("findByUser", () => {
    it("delegates straight to the repository", async () => {
      const params = { userId: "user-1", limit: 10 };

      await service.findByUser(params);

      expect(repository.findByUser).toHaveBeenCalledWith(params);
    });
  });
});
