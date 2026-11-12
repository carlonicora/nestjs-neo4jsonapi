import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralAdminController } from "../controllers/referral.admin.controller";
import { ReferralAdminRepository } from "../repositories/referral.admin.repository";
import { ReferralAdminService } from "../services/referral.admin.service";

/**
 * Column sorting on the Referrals admin list (spec row A3): source, status, referredAt,
 * tokensAwarded. The ORDER BY text comes only from the lookup table in the repository file
 * (cross-tenant administrative read repository, requirement 6). The Referrers list (A2) keeps
 * its own `sort` enum, untouched.
 */

describe("ReferralAdminController.getReferrals sort", () => {
  it("forwards sort", async () => {
    const service = { getReferrals: vi.fn().mockResolvedValue({}) };
    const controller = new ReferralAdminController(service as any);
    await controller.getReferrals({ send: vi.fn() } as any, "30d", "-tokensAwarded");
    expect(service.getReferrals).toHaveBeenCalledWith({ period: "30d", sort: "-tokensAwarded" });
  });
});

describe("ReferralAdminService.getReferrals sort", () => {
  let adminRepository: { findReferrals: ReturnType<typeof vi.fn> };
  let userRepository: { findAdministratorIds?: ReturnType<typeof vi.fn> } & Record<string, any>;
  let service: ReferralAdminService;

  beforeEach(() => {
    adminRepository = { findReferrals: vi.fn().mockResolvedValue([]) };
    userRepository = {};
    service = Object.assign(Object.create(ReferralAdminService.prototype), {
      referralAdminRepository: adminRepository,
      userRepository,
      jsonApiService: { buildList: vi.fn().mockResolvedValue({ data: [] }) },
    });
    vi.spyOn(service as any, "_excludeUserIds").mockResolvedValue([]);
  });

  it("passes the validated sort to the repository", async () => {
    await service.getReferrals({ period: "all", sort: "status,-referredAt" });
    expect(adminRepository.findReferrals.mock.calls[0][0].sort).toEqual([
      { field: "status", direction: "asc" },
      { field: "referredAt", direction: "desc" },
    ]);
  });

  it("refuses a hostile or unknown sort with a 400 before any query", async () => {
    for (const sort of ["status) DETACH DELETE n //", "name", "referrerEmail", "paying", "createdAt", "-updatedAt"]) {
      await expect(service.getReferrals({ period: "all", sort })).rejects.toThrow(BadRequestException);
    }
    expect((service as any)._excludeUserIds).not.toHaveBeenCalled();
    expect(adminRepository.findReferrals).not.toHaveBeenCalled();
  });
});

describe("ReferralAdminRepository.findReferrals sort", () => {
  function setup() {
    const neo4j = { read: vi.fn(async () => ({ records: [] as any[] })) };
    const repository = new ReferralAdminRepository(neo4j as any, {} as any, { get: vi.fn() } as any);
    return { repository, query: () => (neo4j.read.mock.calls[0] as any[])[0] as string };
  }

  it("orders by the lookup-table columns, then the id", async () => {
    const { repository, query } = setup();
    await repository.findReferrals({
      from: null,
      excludeUserIds: [],
      sort: [
        { field: "tokensAwarded", direction: "desc" },
        { field: "source", direction: "asc" },
      ],
    });
    expect(query()).toContain(
      "ORDER BY CASE WHEN tokensAwarded IS :: STRING THEN toLower(tokensAwarded) ELSE tokensAwarded END DESC, CASE WHEN source IS :: STRING THEN toLower(source) ELSE source END ASC, id ASC",
    );
  });

  it("ignores a field missing from the lookup table instead of writing it", async () => {
    const { repository, query } = setup();
    await repository.findReferrals({
      from: null,
      excludeUserIds: [],
      sort: [{ field: "x) DETACH DELETE n", direction: "asc" }],
    });
    expect(query()).not.toContain("DETACH");
    expect(query()).toContain("ORDER BY referredAt DESC, id ASC");
  });

  it("keeps newest first as its default", async () => {
    const { repository, query } = setup();
    await repository.findReferrals({ from: null, excludeUserIds: [] });
    expect(query()).toContain("ORDER BY referredAt DESC, id ASC");
  });
});
