import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Owned by Task 1 (request side); mocked so this spec does not depend on it.
vi.mock("../repositories/account-deletion.repository", () => ({ AccountDeletionRepository: class {} }));
vi.mock("../repositories/account-deletion.wipe.repository", () => ({ AccountDeletionWipeRepository: class {} }));
vi.mock("../../s3/services/s3.service", () => ({ S3Service: class {} }));
vi.mock("../../stripe-customer/services/stripe-customer-api.service", () => ({ StripeCustomerApiService: class {} }));
vi.mock("../../stripe-customer/repositories/stripe-customer.repository", () => ({
  StripeCustomerRepository: class {},
}));
vi.mock("../../../core/cache/services/cache.service", () => ({ CacheService: class {} }));
vi.mock("../../user/services/response-language.service", () => ({ ResponseLanguageService: class {} }));

import { AccountWipeService } from "./account-wipe.service";
import { FullCompanyDeletionService } from "./full-company-deletion.service";

const NOW = new Date("2026-11-01T04:00:00.000Z");
const PAST = new Date("2026-10-31T10:00:00.000Z");
const FUTURE = new Date("2026-11-05T10:00:00.000Z");

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: "u1",
  email: "gm@example.com",
  name: "Gina",
  avatar: "avatars/u1.png",
  deletionScheduledAt: PAST,
  ...overrides,
});

describe("AccountWipeService", () => {
  let queue: { add: ReturnType<typeof vi.fn> };
  let accountDeletionRepository: {
    findTargetUser: ReturnType<typeof vi.fn>;
    findMembershipSummary: ReturnType<typeof vi.fn>;
  };
  let wipeRepository: Record<string, ReturnType<typeof vi.fn>>;
  let stripeCustomerRepository: { findByCompanyId: ReturnType<typeof vi.fn> };
  let stripeCustomerApiService: { deleteCustomer: ReturnType<typeof vi.fn> };
  let s3Service: { deleteFolderFromS3: ReturnType<typeof vi.fn>; deleteFileFromS3: ReturnType<typeof vi.fn> };
  let cacheService: { deleteUserCache: ReturnType<typeof vi.fn> };
  let responseLanguageService: { resolveForEmail: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };
  let cls: Map<string, unknown>;
  let clsService: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let logger: Record<string, ReturnType<typeof vi.fn>>;
  let handler: {
    describeImpact: ReturnType<typeof vi.fn>;
    removeUserTraces: ReturnType<typeof vi.fn>;
    deleteCompanyContent: ReturnType<typeof vi.fn>;
  };
  let fullCompany: FullCompanyDeletionService;
  let service: AccountWipeService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    queue = { add: vi.fn().mockResolvedValue(undefined) };
    accountDeletionRepository = {
      findTargetUser: vi.fn().mockResolvedValue(makeUser()),
      findMembershipSummary: vi.fn().mockResolvedValue({ companyId: "c1", memberCount: 1 }),
    };
    wipeRepository = {
      deleteUserLinkedNodes: vi.fn().mockResolvedValue(undefined),
      detachUserFromForeignNodes: vi.fn().mockResolvedValue(undefined),
      deleteEmailKeyed: vi.fn().mockResolvedValue(undefined),
      deleteStripeNodes: vi.fn().mockResolvedValue(undefined),
      deleteCompanyNodes: vi.fn().mockResolvedValue(undefined),
      deleteDisconnectedKnowledge: vi.fn().mockResolvedValue(undefined),
      deleteCompanyShell: vi.fn().mockResolvedValue(undefined),
      deleteUserNode: vi.fn().mockResolvedValue(undefined),
      findCompanyUserIds: vi.fn().mockResolvedValue(["u1"]),
    };
    stripeCustomerRepository = { findByCompanyId: vi.fn().mockResolvedValue({ stripeCustomerId: "cus_1" }) };
    stripeCustomerApiService = { deleteCustomer: vi.fn().mockResolvedValue({ deleted: true }) };
    s3Service = {
      deleteFolderFromS3: vi.fn().mockResolvedValue(undefined),
      deleteFileFromS3: vi.fn().mockResolvedValue(undefined),
    };
    cacheService = { deleteUserCache: vi.fn().mockResolvedValue(undefined) };
    responseLanguageService = { resolveForEmail: vi.fn().mockResolvedValue("it") };
    configService = { get: vi.fn().mockReturnValue({ emailLocale: "en" }) };
    cls = new Map();
    clsService = {
      get: vi.fn((key: string) => cls.get(key)),
      set: vi.fn((key: string, value: unknown) => cls.set(key, value)),
    };
    logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    handler = {
      describeImpact: vi.fn(),
      removeUserTraces: vi.fn().mockResolvedValue(undefined),
      deleteCompanyContent: vi.fn().mockResolvedValue(undefined),
    };

    fullCompany = new FullCompanyDeletionService(
      {} as never,
      queue as never,
      wipeRepository as never,
      accountDeletionRepository as never,
      stripeCustomerRepository as never,
      stripeCustomerApiService as never,
      s3Service as never,
      cacheService as never,
      clsService as never,
      logger as never,
      { get: () => handler } as never,
    );
    service = new AccountWipeService(
      {} as never,
      queue as never,
      accountDeletionRepository as never,
      wipeRepository as never,
      fullCompany,
      responseLanguageService as never,
      configService as never,
      clsService as never,
      logger as never,
      { get: () => handler } as never,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("deleteAccount", () => {
    it("only member: runs removeUserTraces with wipedCompanyId, then wipeCompany, then user-linked cleanup, cache, final email, user node — in that order", async () => {
      const wipeCompany = vi.spyOn(fullCompany, "wipeCompany");

      await service.deleteAccount({ userId: "u1" });

      expect(handler.removeUserTraces).toHaveBeenCalledWith({ userId: "u1", wipedCompanyId: "c1" });
      expect(wipeCompany).toHaveBeenCalledWith({ companyId: "c1" });

      const order = [
        handler.removeUserTraces.mock.invocationCallOrder[0],
        wipeCompany.mock.invocationCallOrder[0],
        wipeRepository.deleteUserLinkedNodes.mock.invocationCallOrder[0],
        cacheService.deleteUserCache.mock.invocationCallOrder[0],
        queue.add.mock.invocationCallOrder[0],
        wipeRepository.deleteUserNode.mock.invocationCallOrder.at(-1)!,
      ];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(wipeRepository.deleteUserNode).toHaveBeenLastCalledWith({ userId: "u1" });
      expect(cls.get("userId")).toBe("u1");
      expect(cls.get("companyId")).toBe("c1");
    });

    it("placeholder user keeps the company", async () => {
      accountDeletionRepository.findTargetUser.mockResolvedValue(
        makeUser({ email: "player-df4af9c5@narr8.local", avatar: undefined }),
      );
      accountDeletionRepository.findMembershipSummary.mockResolvedValue({ companyId: null, memberCount: 0 });
      const wipeCompany = vi.spyOn(fullCompany, "wipeCompany");

      await service.deleteAccount({ userId: "u1" });

      expect(wipeCompany).not.toHaveBeenCalled();
      expect(handler.removeUserTraces).toHaveBeenCalledWith({ userId: "u1", wipedCompanyId: undefined });
      expect(wipeRepository.deleteCompanyNodes).not.toHaveBeenCalled();
      expect(wipeRepository.deleteCompanyShell).not.toHaveBeenCalled();
      expect(wipeRepository.deleteUserNode).toHaveBeenCalledWith({ userId: "u1" });
    });

    it("keeps a company with other members", async () => {
      accountDeletionRepository.findMembershipSummary.mockResolvedValue({ companyId: "c1", memberCount: 2 });
      const wipeCompany = vi.spyOn(fullCompany, "wipeCompany");

      await service.deleteAccount({ userId: "u1" });

      expect(wipeCompany).not.toHaveBeenCalled();
      expect(handler.removeUserTraces).toHaveBeenCalledWith({ userId: "u1", wipedCompanyId: undefined });
      expect(wipeRepository.deleteUserLinkedNodes).toHaveBeenCalledWith({ userId: "u1", batchSize: 1000 });
    });

    it.each([
      ["cleared", undefined],
      ["in the future", FUTURE],
    ])("skips a cancelled request (deletionScheduledAt %s)", async (_label, deletionScheduledAt) => {
      accountDeletionRepository.findTargetUser.mockResolvedValue(makeUser({ deletionScheduledAt }));

      await service.deleteAccount({ userId: "u1" });

      expect(handler.removeUserTraces).not.toHaveBeenCalled();
      expect(wipeRepository.deleteUserLinkedNodes).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(wipeRepository.deleteUserNode).not.toHaveBeenCalled();
    });

    it("missing user is a no-op", async () => {
      accountDeletionRepository.findTargetUser.mockResolvedValue(null);

      await service.deleteAccount({ userId: "u1" });

      expect(accountDeletionRepository.findMembershipSummary).not.toHaveBeenCalled();
      expect(handler.removeUserTraces).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(wipeRepository.deleteUserNode).not.toHaveBeenCalled();
    });

    it("undeliverable email sends no final email", async () => {
      accountDeletionRepository.findTargetUser.mockResolvedValue(makeUser({ email: "123456789012345678" }));

      await service.deleteAccount({ userId: "u1" });

      expect(queue.add).not.toHaveBeenCalled();
      expect(responseLanguageService.resolveForEmail).not.toHaveBeenCalled();
      expect(wipeRepository.deleteUserNode).toHaveBeenCalledWith({ userId: "u1" });
    });

    it("final email queued with job id account-deleted-email-<userId>", async () => {
      await service.deleteAccount({ userId: "u1" });

      expect(queue.add).toHaveBeenCalledWith(
        "account-deleted-email",
        { to: "gm@example.com", name: "Gina", locale: "it" },
        expect.objectContaining({ jobId: "account-deleted-email-u1" }),
      );
    });

    it("falls back to the auth email locale", async () => {
      responseLanguageService.resolveForEmail.mockResolvedValue(undefined);

      await service.deleteAccount({ userId: "u1" });

      expect(queue.add).toHaveBeenCalledWith(
        "account-deleted-email",
        expect.objectContaining({ locale: "en" }),
        expect.anything(),
      );
    });

    it("deletes an avatar outside the wiped company folder, never a ~ avatar", async () => {
      await service.deleteAccount({ userId: "u1" });
      expect(s3Service.deleteFileFromS3).toHaveBeenCalledWith({ key: "avatars/u1.png" });

      s3Service.deleteFileFromS3.mockClear();
      accountDeletionRepository.findTargetUser.mockResolvedValue(makeUser({ avatar: "companies/c1/avatars/u1.png" }));
      await service.deleteAccount({ userId: "u1" });
      expect(s3Service.deleteFileFromS3).not.toHaveBeenCalled();

      accountDeletionRepository.findTargetUser.mockResolvedValue(
        makeUser({ avatar: "~https://cdn.example.com/a.png" }),
      );
      await service.deleteAccount({ userId: "u1" });
      expect(s3Service.deleteFileFromS3).not.toHaveBeenCalled();
    });
  });

  describe("processor", () => {
    it("re-run after partial wipe sends one email", async () => {
      // First run dies on the very last step.
      wipeRepository.deleteUserNode.mockRejectedValueOnce(new Error("Neo4j connection lost"));
      await expect(service.deleteAccount({ userId: "u1" })).rejects.toThrow("Neo4j connection lost");

      // Second run: the company is already gone in Stripe.
      stripeCustomerApiService.deleteCustomer.mockRejectedValue(
        Object.assign(new Error("No such customer: 'cus_1'"), { stripeCode: "resource_missing" }),
      );
      cls.clear();
      await expect(service.deleteAccount({ userId: "u1" })).resolves.toBeUndefined();

      const emailAdds = queue.add.mock.calls.filter(([name]) => name === "account-deleted-email");
      expect(emailAdds).toHaveLength(2);
      // Same job id both times: BullMQ keeps the first (completed jobs are retained) and ignores the second.
      expect(emailAdds[0][2].jobId).toBe("account-deleted-email-u1");
      expect(emailAdds[1][2].jobId).toBe(emailAdds[0][2].jobId);
      expect(emailAdds[0][2].removeOnComplete).not.toBe(true);
      expect(wipeRepository.deleteUserNode).toHaveBeenLastCalledWith({ userId: "u1" });
    });
  });

  describe("wipeCompany", () => {
    it('deletes the Stripe customer, tolerating "No such customer"', async () => {
      await fullCompany.wipeCompany({ companyId: "c1" });
      expect(stripeCustomerApiService.deleteCustomer).toHaveBeenCalledWith("cus_1");
      expect(wipeRepository.deleteStripeNodes).toHaveBeenCalledWith({ companyId: "c1", batchSize: 1000 });

      stripeCustomerApiService.deleteCustomer.mockRejectedValue(
        Object.assign(new Error("No such customer: 'cus_1'"), { stripeCode: "resource_missing" }),
      );
      await expect(fullCompany.wipeCompany({ companyId: "c1" })).resolves.toBeUndefined();
      expect(wipeRepository.deleteCompanyShell).toHaveBeenCalledTimes(2);
    });

    it("rethrows any other Stripe error", async () => {
      stripeCustomerApiService.deleteCustomer.mockRejectedValue(
        Object.assign(new Error("Payment service temporarily unavailable"), { stripeCode: "api_error" }),
      );
      await expect(fullCompany.wipeCompany({ companyId: "c1" })).rejects.toThrow("temporarily unavailable");
      expect(wipeRepository.deleteCompanyShell).not.toHaveBeenCalled();
    });

    it("deletes the S3 prefix companies/<id>/", async () => {
      await fullCompany.wipeCompany({ companyId: "c1" });
      expect(s3Service.deleteFolderFromS3).toHaveBeenCalledWith({ key: "companies/c1/" });
    });

    it("calls deleteCompanyNodes with batchSize 1000", async () => {
      await fullCompany.wipeCompany({ companyId: "c1" });
      expect(wipeRepository.deleteCompanyNodes).toHaveBeenCalledWith({ companyId: "c1", batchSize: 1000 });
      expect(wipeRepository.deleteDisconnectedKnowledge).toHaveBeenCalledWith({ batchSize: 1000 });
      expect(wipeRepository.deleteCompanyShell).toHaveBeenCalledWith({ companyId: "c1" });
      expect(handler.deleteCompanyContent.mock.invocationCallOrder[0]).toBeLessThan(
        wipeRepository.deleteCompanyNodes.mock.invocationCallOrder[0],
      );
    });

    it("deletes placeholder users that belong to the company", async () => {
      cls.set("userId", "u1");
      wipeRepository.findCompanyUserIds.mockResolvedValue(["u1", "p1"]);
      accountDeletionRepository.findMembershipSummary.mockImplementation(async ({ userId }: { userId: string }) =>
        userId === "p1" ? { companyId: null, memberCount: 0 } : { companyId: "c1", memberCount: 1 },
      );
      accountDeletionRepository.findTargetUser.mockImplementation(async ({ userId }: { userId: string }) =>
        makeUser({ id: userId, email: `player-${userId}@narr8.local`, avatar: undefined }),
      );

      await fullCompany.wipeCompany({ companyId: "c1" });

      expect(wipeRepository.deleteUserLinkedNodes).toHaveBeenCalledWith({ userId: "p1", batchSize: 1000 });
      expect(wipeRepository.deleteUserNode).toHaveBeenCalledWith({ userId: "p1" });
      expect(wipeRepository.deleteUserNode).not.toHaveBeenCalledWith({ userId: "u1" });
      expect(wipeRepository.deleteUserNode.mock.invocationCallOrder[0]).toBeLessThan(
        wipeRepository.deleteCompanyNodes.mock.invocationCallOrder[0],
      );
    });

    it("sets the first company user in CLS when none is set (admin company delete)", async () => {
      wipeRepository.findCompanyUserIds.mockResolvedValue(["gm1"]);

      await fullCompany.wipeCompany({ companyId: "c1" });

      expect(cls.get("userId")).toBe("gm1");
      expect(handler.deleteCompanyContent).toHaveBeenCalledWith({ companyId: "c1", actingUserId: "gm1" });
    });
  });

  describe("FullCompanyDeletionService.deleteCompany", () => {
    it("enqueues delete-company with job id company-deletion-<id>", async () => {
      await fullCompany.deleteCompany("c1", "Acme", { sendEmail: true, reason: "immediate_deletion" });

      expect(queue.add).toHaveBeenCalledWith(
        "delete-company",
        { companyId: "c1" },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: { count: 100 },
          jobId: "company-deletion-c1",
        },
      );
      expect(handler.deleteCompanyContent).not.toHaveBeenCalled();
    });
  });
});
