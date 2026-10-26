import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Owned by Task 1 (request side); mocked so this spec does not depend on it.
vi.mock("../repositories/account-deletion.repository", () => ({ AccountDeletionRepository: class {} }));

import { ACCOUNT_DELETION_JOB_OPTIONS } from "../account-deletion.constants";
import { AccountDeletionCron } from "./account-deletion.cron";

describe("AccountDeletionCron", () => {
  let queue: { add: ReturnType<typeof vi.fn>; getJob: ReturnType<typeof vi.fn> };
  let repository: { findDue: ReturnType<typeof vi.fn> };
  let clsService: { run: ReturnType<typeof vi.fn> };
  let logger: Record<string, ReturnType<typeof vi.fn>>;
  let cron: AccountDeletionCron;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T04:00:00.000Z"));
    queue = { add: vi.fn().mockResolvedValue(undefined), getJob: vi.fn().mockResolvedValue(undefined) };
    repository = { findDue: vi.fn().mockResolvedValue([{ id: "u1" }, { id: "u2" }]) };
    clsService = { run: vi.fn(async (fn: () => Promise<void>) => fn()) };
    logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    cron = new AccountDeletionCron(queue as never, repository as never, clsService as never, logger as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("enqueueDue", () => {
    it("one delete-account job per due user, job id account-deletion-<userId>, ACCOUNT_DELETION_JOB_OPTIONS", async () => {
      await cron.enqueueDue();

      expect(clsService.run).toHaveBeenCalledTimes(1);
      expect(repository.findDue).toHaveBeenCalledWith({ now: "2026-11-01T04:00:00.000Z" });
      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(queue.add).toHaveBeenCalledWith(
        "delete-account",
        { userId: "u1" },
        { ...ACCOUNT_DELETION_JOB_OPTIONS, jobId: "account-deletion-u1" },
      );
      expect(queue.add).toHaveBeenCalledWith(
        "delete-account",
        { userId: "u2" },
        { ...ACCOUNT_DELETION_JOB_OPTIONS, jobId: "account-deletion-u2" },
      );
      for (const [, , options] of queue.add.mock.calls) expect(options.jobId).not.toContain(":");
    });

    it("removes a job that failed every attempt before queuing it again", async () => {
      const failed = { isFailed: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(undefined) };
      queue.getJob.mockImplementation(async (id: string) => (id === "account-deletion-u1" ? failed : undefined));

      await cron.enqueueDue();

      expect(failed.remove).toHaveBeenCalledTimes(1);
      expect(failed.remove.mock.invocationCallOrder[0]).toBeLessThan(queue.add.mock.invocationCallOrder[0]);
    });

    it("leaves a waiting or active job alone", async () => {
      const waiting = { isFailed: vi.fn().mockResolvedValue(false), remove: vi.fn() };
      queue.getJob.mockResolvedValue(waiting);

      await cron.enqueueDue();

      expect(waiting.remove).not.toHaveBeenCalled();
    });

    it("keeps queuing the others when one add fails", async () => {
      queue.add.mockRejectedValueOnce(new Error("Redis down"));

      await cron.enqueueDue();

      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to queue account deletion u1: Redis down",
        "AccountDeletionCron",
      );
    });

    it("queues nothing when no deletion is due", async () => {
      repository.findDue.mockResolvedValue([]);

      await cron.enqueueDue();

      expect(queue.add).not.toHaveBeenCalled();
    });
  });
});
