import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralAdminReferralDescriptor } from "../entities/referral-admin-referral";
import { ReferralAdminReferrerDescriptor } from "../entities/referral-admin-referrer";
import { ReferralAdminSummaryDescriptor } from "../entities/referral-admin-summary";
import { ReferralAdminService } from "../services/referral.admin.service";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function makeService() {
  const jsonApiService = { buildList: vi.fn(async () => ({ data: [] })) } as any;
  const referralRepository = {} as any;
  const clsService = { get: vi.fn() } as any;
  const adminRepository = {
    findSummary: vi.fn(async () => []),
    findReferrers: vi.fn(async () => []),
    findReferrals: vi.fn(async () => []),
  } as any;
  const userRepository = {
    findPlatformAdministrators: vi.fn(async () => [{ id: "admin-1" }, { id: "admin-2" }]),
  } as any;
  const service = new ReferralAdminService(
    jsonApiService,
    referralRepository,
    clsService,
    adminRepository,
    userRepository,
  );
  return { service, jsonApiService, adminRepository, userRepository };
}

describe("ReferralAdminService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("period 30d gives from = now - 30 days and previousFrom = now - 60 days", async () => {
    const { service, adminRepository } = makeService();

    await service.getSummary({ period: "30d" });

    expect(adminRepository.findSummary).toHaveBeenCalledWith({
      from: new Date(NOW.getTime() - 30 * ONE_DAY_MS).toISOString(),
      previousFrom: new Date(NOW.getTime() - 60 * ONE_DAY_MS).toISOString(),
      to: NOW.toISOString(),
      excludeUserIds: ["admin-1", "admin-2"],
    });
  });

  it("period 90d gives from = now - 90 days", async () => {
    const { service, adminRepository } = makeService();

    await service.getReferrals({ period: "90d" });

    expect(adminRepository.findReferrals).toHaveBeenCalledWith({
      from: new Date(NOW.getTime() - 90 * ONE_DAY_MS).toISOString(),
      excludeUserIds: ["admin-1", "admin-2"],
    });
  });

  it("period all gives from = null and previousFrom = null", async () => {
    const { service, adminRepository } = makeService();

    await service.getSummary({ period: "all" });
    await service.getReferrers({ period: "all", sort: "credits" });

    expect(adminRepository.findSummary).toHaveBeenCalledWith(
      expect.objectContaining({ from: null, previousFrom: null, to: NOW.toISOString() }),
    );
    expect(adminRepository.findReferrers).toHaveBeenCalledWith({
      from: null,
      sort: "credits",
      excludeUserIds: ["admin-1", "admin-2"],
    });
  });

  it("passes administrator ids from findPlatformAdministrators", async () => {
    const { service, adminRepository, userRepository } = makeService();

    await service.getReferrers({ period: "30d", sort: "paying" });

    expect(userRepository.findPlatformAdministrators).toHaveBeenCalled();
    expect(adminRepository.findReferrers).toHaveBeenCalledWith(
      expect.objectContaining({ excludeUserIds: ["admin-1", "admin-2"] }),
    );
  });

  it("serialises with the admin descriptors", async () => {
    const { service, jsonApiService, adminRepository } = makeService();
    const summaryRows = [{ id: "current" }];
    const referrerRows = [{ id: "company-1" }];
    const referralRows = [{ id: "referral-1" }];
    adminRepository.findSummary.mockResolvedValue(summaryRows);
    adminRepository.findReferrers.mockResolvedValue(referrerRows);
    adminRepository.findReferrals.mockResolvedValue(referralRows);

    await service.getSummary({ period: "30d" });
    await service.getReferrers({ period: "30d", sort: "paying" });
    await service.getReferrals({ period: "30d" });

    expect(jsonApiService.buildList).toHaveBeenNthCalledWith(1, ReferralAdminSummaryDescriptor.model, summaryRows);
    expect(jsonApiService.buildList).toHaveBeenNthCalledWith(2, ReferralAdminReferrerDescriptor.model, referrerRows);
    expect(jsonApiService.buildList).toHaveBeenNthCalledWith(3, ReferralAdminReferralDescriptor.model, referralRows);
  });
});
