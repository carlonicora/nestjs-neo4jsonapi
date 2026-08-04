import { Job } from "bullmq";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_ACTIVITY_CONFIG } from "../../interfaces/user-activity.config.interface";
import { UserActivityRepository } from "../../repositories/user-activity.repository";
import { UserActivityProcessor } from "../user-activity.processor";

describe("UserActivityProcessor", () => {
  let processor: UserActivityProcessor;
  let repository: { createActivity: ReturnType<typeof vi.fn> };
  let logger: { error: ReturnType<typeof vi.fn> };
  let clsValues: Record<string, unknown>;
  let cls: ClsService;

  const build = (config = DEFAULT_USER_ACTIVITY_CONFIG) => {
    repository = { createActivity: vi.fn(async () => undefined) };
    logger = { error: vi.fn() };
    clsValues = {};
    cls = {
      run: vi.fn(async (fn: () => Promise<void>) => fn()),
      set: vi.fn((key: string, value: unknown) => {
        clsValues[key] = value;
      }),
      get: vi.fn((key: string) => clsValues[key]),
    } as unknown as ClsService;

    return new UserActivityProcessor(logger as any, repository as unknown as UserActivityRepository, cls, config);
  };

  const job = (name: string, data: Record<string, unknown> = {}) => ({ id: "job-1", name, data }) as unknown as Job;

  beforeEach(() => {
    processor = build();
  });

  it("rejects jobs it does not own", async () => {
    await expect(processor.process(job("someOtherQueue:job"))).rejects.toThrow(
      "Job someOtherQueue:job not handled by UserActivityProcessor",
    );
    expect(repository.createActivity).not.toHaveBeenCalled();
  });

  it("rejects the DEFAULT job name when a custom one is configured", async () => {
    processor = build({ ...DEFAULT_USER_ACTIVITY_CONFIG, jobName: "app:userActivity:record" });

    await expect(processor.process(job("userActivity:record"))).rejects.toThrow("not handled by UserActivityProcessor");

    await processor.process(job("app:userActivity:record", { userId: "u", companyId: "c" }));
    expect(repository.createActivity).toHaveBeenCalledTimes(1);
  });

  it("seeds CLS (isAutomatedJob + userId + companyId) before writing", async () => {
    const input = {
      userId: "user-1",
      companyId: "company-1",
      category: "ENTITY",
      action: "CREATE",
    };

    await processor.process(job("userActivity:record", input));

    // Without this seeding SecurityService.userHasAccess() has no HTTP context
    // to read from and blows up inside the worker.
    expect(cls.run).toHaveBeenCalledTimes(1);
    expect(clsValues).toEqual({
      isAutomatedJob: true,
      userId: "user-1",
      companyId: "company-1",
    });
    expect(repository.createActivity).toHaveBeenCalledWith(input);
  });

  it("logs failures via the failed worker event", () => {
    processor.onError({ id: "job-9", failedReason: "boom" } as unknown as Job);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
