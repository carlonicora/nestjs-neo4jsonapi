import { beforeEach, describe, expect, it, vi } from "vitest";

// Sibling-owned classes, replaced so the cron is exercised in isolation.
vi.mock("../../repositories/analytics-session.repository", () => ({ AnalyticsSessionRepository: class {} }));
vi.mock("../../repositories/analytics-daily-summary.repository", () => ({ AnalyticsDailySummaryRepository: class {} }));
vi.mock("../../services/analytics.admin.service", () => ({ AnalyticsAdminService: class {} }));

import { AnalyticsRetentionCron } from "../analytics-retention.cron";

describe("AnalyticsRetentionCron", () => {
  let cron: AnalyticsRetentionCron;
  let calls: string[];
  let sessionRepository: {
    findExpiredDays: ReturnType<typeof vi.fn>;
    deleteDay: ReturnType<typeof vi.fn>;
    unlinkDeletedUsers: ReturnType<typeof vi.fn>;
  };
  let dailySummaryRepository: { rollupDay: ReturnType<typeof vi.fn> };
  let adminService: { retentionCutoff: ReturnType<typeof vi.fn> };
  let logger: { log: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    sessionRepository = {
      findExpiredDays: vi.fn().mockResolvedValue(["2025-08-01", "2025-08-02"]),
      deleteDay: vi.fn(async ({ date }: { date: string }) => {
        calls.push(`deleteDay(${date})`);
        return { sessions: 2, pageViews: 5 };
      }),
      unlinkDeletedUsers: vi.fn(async () => {
        calls.push("unlinkDeletedUsers");
        return 1;
      }),
    };
    dailySummaryRepository = {
      rollupDay: vi.fn(async ({ date }: { date: string }) => {
        calls.push(`rollupDay(${date})`);
        return 7;
      }),
    };
    adminService = { retentionCutoff: vi.fn().mockReturnValue("2025-09-03") };
    logger = { log: vi.fn(), error: vi.fn() };
    cron = new AnalyticsRetentionCron(
      sessionRepository as any,
      dailySummaryRepository as any,
      adminService as any,
      logger as any,
    );
  });

  it("rolls up then deletes each expired day, oldest first, max 31", async () => {
    await cron.run();

    expect(sessionRepository.findExpiredDays).toHaveBeenCalledWith({ cutoff: "2025-09-03", limit: 31 });
    expect(calls.slice(0, 4)).toEqual([
      "rollupDay(2025-08-01)",
      "deleteDay(2025-08-01)",
      "rollupDay(2025-08-02)",
      "deleteDay(2025-08-02)",
    ]);
    expect(dailySummaryRepository.rollupDay).toHaveBeenCalledWith({ date: "2025-08-01" });
    expect(sessionRepository.deleteDay).toHaveBeenCalledWith({ date: "2025-08-02" });
    expect(logger.log).toHaveBeenCalled();
  });

  it("unlinks deleted users after the day loop", async () => {
    await cron.run();

    expect(sessionRepository.unlinkDeletedUsers).toHaveBeenCalledTimes(1);
    expect(calls[calls.length - 1]).toBe("unlinkDeletedUsers");
  });

  it("unlinks deleted users when no day has expired", async () => {
    sessionRepository.findExpiredDays.mockResolvedValue([]);

    await cron.run();

    expect(dailySummaryRepository.rollupDay).not.toHaveBeenCalled();
    expect(sessionRepository.deleteDay).not.toHaveBeenCalled();
    expect(sessionRepository.unlinkDeletedUsers).toHaveBeenCalledTimes(1);
  });

  it("a failing day is logged and does not stop the others", async () => {
    dailySummaryRepository.rollupDay.mockRejectedValueOnce(new Error("Neo4j connection lost"));

    await cron.run();

    expect(sessionRepository.deleteDay).toHaveBeenCalledTimes(1);
    expect(sessionRepository.deleteDay).toHaveBeenCalledWith({ date: "2025-08-02" });
    expect(sessionRepository.deleteDay).not.toHaveBeenCalledWith({ date: "2025-08-01" });
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to roll up and delete analytics day 2025-08-01: Neo4j connection lost",
      "AnalyticsRetentionCron",
    );
    expect(sessionRepository.unlinkDeletedUsers).toHaveBeenCalledTimes(1);
  });
});
