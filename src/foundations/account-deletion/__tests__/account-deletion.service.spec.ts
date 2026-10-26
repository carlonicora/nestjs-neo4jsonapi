import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AsyncLocalStorage } from "async_hooks";
import { createHash } from "crypto";
import { ClsService } from "nestjs-cls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemRoles } from "../../../common/constants/system.roles";
import { AccountDeletionService } from "../services/account-deletion.service";

const NOW = new Date("2026-10-25T10:00:00.000Z");
const SEVEN_DAYS_LATER = new Date("2026-11-01T10:00:00.000Z");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_COMPANY_ID = "44444444-4444-4444-8444-444444444444";

const makeUser = (overrides: Record<string, any> = {}) => ({
  id: USER_ID,
  email: "gm@example.com",
  name: "Gina",
  company: { id: COMPANY_ID },
  ...overrides,
});

describe("AccountDeletionService", () => {
  let cls: ClsService;
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let stripeCustomerRepository: { findByCompanyId: ReturnType<typeof vi.fn> };
  let stripeSubscriptionRepository: {
    findByStripeCustomerId: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let stripeSubscriptionApiService: { cancelSubscription: ReturnType<typeof vi.fn> };
  let emailService: { sendEmail: ReturnType<typeof vi.fn> };
  let responseLanguage: { resolveForEmail: ReturnType<typeof vi.fn> };
  let handler: { describeImpact: ReturnType<typeof vi.fn> } | undefined;
  let service: AccountDeletionService;

  const build = () => {
    const jsonApiService = { buildSingle: vi.fn(async (_model: any, data: any) => ({ data })) };
    const configService = {
      get: vi.fn((key: string) => (key === "app" ? { url: "https://app.test/" } : { emailLocale: "en" })),
    };
    const moduleRef = {
      get: vi.fn(() => {
        if (!handler) throw new Error("not provided");
        return handler;
      }),
    };

    service = new AccountDeletionService(
      jsonApiService as any,
      repository as any,
      cls,
      stripeCustomerRepository as any,
      stripeSubscriptionRepository as any,
      stripeSubscriptionApiService as any,
      emailService as any,
      responseLanguage as any,
      configService as any,
      moduleRef as any,
      { graceDays: 7 },
    );
  };

  /** Runs as a signed-in caller, the way JwtAuthGuard fills CLS. */
  const asCaller = <T>(params: { userId: string; companyId: string; roles?: string[] }, fn: () => Promise<T>) =>
    cls.run(async () => {
      cls.set("userId", params.userId);
      cls.set("companyId", params.companyId);
      cls.set("roles", params.roles ?? []);
      return fn();
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    cls = new ClsService(new AsyncLocalStorage());
    repository = {
      findTargetUser: vi.fn().mockResolvedValue(makeUser()),
      findMembershipSummary: vi.fn().mockResolvedValue({ companyId: COMPANY_ID, memberCount: 1 }),
      setRequest: vi.fn().mockResolvedValue(undefined),
      clearRequest: vi.fn().mockResolvedValue(undefined),
      deleteSessions: vi.fn().mockResolvedValue(undefined),
      findByUndoTokenHash: vi.fn().mockResolvedValue(null),
    };
    stripeCustomerRepository = {
      findByCompanyId: vi.fn().mockResolvedValue({ id: "customer-node-1", stripeCustomerId: "cus_1" }),
    };
    stripeSubscriptionRepository = {
      findByStripeCustomerId: vi.fn().mockResolvedValue([
        { id: "local-sub-1", stripeSubscriptionId: "sub_1", status: "active" },
        { id: "local-sub-2", stripeSubscriptionId: "sub_2", status: "past_due" },
        { id: "local-sub-3", stripeSubscriptionId: "sub_3", status: "canceled" },
      ]),
      update: vi.fn().mockResolvedValue({}),
    };
    stripeSubscriptionApiService = { cancelSubscription: vi.fn().mockResolvedValue({}) };
    emailService = { sendEmail: vi.fn().mockResolvedValue(undefined) };
    responseLanguage = { resolveForEmail: vi.fn().mockResolvedValue("en") };
    handler = { describeImpact: vi.fn().mockResolvedValue({ ownedCount: 3, otherTables: ["The Long Road"] }) };
    build();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("request", () => {
    it("self request with matching email sets a 7-day date, deletes sessions, cancels active subscriptions immediately and sends accountDeletionRequested", async () => {
      const result: any = await asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
        service.request({ targetUserId: USER_ID, actingUserId: USER_ID, confirmation: "  GM@Example.com " }),
      );

      expect(repository.setRequest).toHaveBeenCalledWith({
        userId: USER_ID,
        requestedAt: NOW.toISOString(),
        scheduledAt: SEVEN_DAYS_LATER.toISOString(),
        undoTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(repository.deleteSessions).toHaveBeenCalledWith({ userId: USER_ID });
      expect(stripeSubscriptionApiService.cancelSubscription).toHaveBeenCalledTimes(2);
      expect(stripeSubscriptionApiService.cancelSubscription).toHaveBeenCalledWith("sub_1", false);
      expect(stripeSubscriptionApiService.cancelSubscription).toHaveBeenCalledWith("sub_2", false);
      expect(stripeSubscriptionRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: "customer-node-1",
      });
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        "accountDeletionRequested",
        {
          to: "gm@example.com",
          name: "Gina",
          deletionDate: SEVEN_DAYS_LATER.toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" }),
          keepUrl: expect.stringContaining("account/keep?token="),
          subscriptionCancelled: true,
        },
        "en",
      );
      expect(result.data.scheduledAt).toEqual(SEVEN_DAYS_LATER);
    });

    it("the stored hash is the sha256 of the token in the keep link", async () => {
      await asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
        service.request({ targetUserId: USER_ID, actingUserId: USER_ID, confirmation: "gm@example.com" }),
      );

      const keepUrl: string = emailService.sendEmail.mock.calls[0][1].keepUrl;
      const token = decodeURIComponent(keepUrl.split("token=")[1]);
      const stored = repository.setRequest.mock.calls[0][0].undoTokenHash;
      expect(createHash("sha256").update(token).digest("hex")).toBe(stored);
    });

    it("marks each cancelled subscription locally, and treats one Stripe no longer knows as cancelled", async () => {
      stripeSubscriptionApiService.cancelSubscription.mockRejectedValueOnce(
        Object.assign(new Error("No such subscription: 'sub_1'"), { code: "resource_missing" }),
      );

      await asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
        service.request({ targetUserId: USER_ID, actingUserId: USER_ID, confirmation: "gm@example.com" }),
      );

      expect(stripeSubscriptionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: "local-sub-1", status: "canceled" }),
      );
      expect(stripeSubscriptionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: "local-sub-2", status: "canceled" }),
      );
      expect(repository.setRequest).toHaveBeenCalled();
    });

    it("a Stripe failure stores no request, so a retry cancels again", async () => {
      stripeSubscriptionApiService.cancelSubscription.mockRejectedValueOnce(new Error("stripe down"));

      await expect(
        asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
          service.request({ targetUserId: USER_ID, actingUserId: USER_ID, confirmation: "gm@example.com" }),
        ),
      ).rejects.toThrow("stripe down");

      expect(repository.setRequest).not.toHaveBeenCalled();
      expect(repository.deleteSessions).not.toHaveBeenCalled();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it("rejects a confirmation that does not match the email", async () => {
      await expect(
        asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
          service.request({ targetUserId: USER_ID, actingUserId: USER_ID, confirmation: "someone@else.com" }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.setRequest).not.toHaveBeenCalled();
      expect(repository.deleteSessions).not.toHaveBeenCalled();
      expect(stripeSubscriptionApiService.cancelSubscription).not.toHaveBeenCalled();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it.each(["DELETE", "elimina", " Delete "])(
      "undeliverable email accepts DELETE and ELIMINA, sends no email, stores no undo token (%s)",
      async (confirmation) => {
        repository.findTargetUser.mockResolvedValue(makeUser({ email: "player-df4af9c5@narr8.local" }));

        await asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
          service.request({ targetUserId: USER_ID, actingUserId: USER_ID, confirmation }),
        );

        expect(repository.setRequest).toHaveBeenCalledWith(expect.objectContaining({ undoTokenHash: null }));
        expect(emailService.sendEmail).not.toHaveBeenCalled();
      },
    );

    it("undeliverable email rejects its own address as confirmation", async () => {
      repository.findTargetUser.mockResolvedValue(makeUser({ email: "123456789012345678" }));

      await expect(
        asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
          service.request({ targetUserId: USER_ID, actingUserId: USER_ID, confirmation: "123456789012345678" }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("non-administrator targeting another user is forbidden", async () => {
      await expect(
        asCaller({ userId: ADMIN_ID, companyId: ADMIN_COMPANY_ID, roles: [] }, () =>
          service.request({ targetUserId: USER_ID, actingUserId: ADMIN_ID, confirmation: "gm@example.com" }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(repository.findTargetUser).not.toHaveBeenCalled();
      expect(repository.setRequest).not.toHaveBeenCalled();
    });

    it("an administrator can request for another user", async () => {
      await asCaller({ userId: ADMIN_ID, companyId: ADMIN_COMPANY_ID, roles: [SystemRoles.Administrator] }, () =>
        service.request({ targetUserId: USER_ID, actingUserId: ADMIN_ID, confirmation: "gm@example.com" }),
      );

      expect(repository.setRequest).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
    });

    it("placeholder (no membership) cancels no subscription", async () => {
      repository.findMembershipSummary.mockResolvedValue({ companyId: null, memberCount: 0 });

      await asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
        service.request({ targetUserId: USER_ID, actingUserId: USER_ID, confirmation: "gm@example.com" }),
      );

      expect(stripeCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(stripeSubscriptionApiService.cancelSubscription).not.toHaveBeenCalled();
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        "accountDeletionRequested",
        expect.objectContaining({ subscriptionCancelled: false }),
        "en",
      );
    });

    it("second request keeps the date", async () => {
      const storedRequestedAt = new Date("2026-10-23T08:00:00.000Z");
      const storedScheduledAt = new Date("2026-10-30T08:00:00.000Z");
      repository.findTargetUser.mockResolvedValue(
        makeUser({ deletionRequestedAt: storedRequestedAt, deletionScheduledAt: storedScheduledAt }),
      );

      const result: any = await asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
        service.request({ targetUserId: USER_ID, actingUserId: USER_ID, confirmation: "gm@example.com" }),
      );

      expect(result.data.scheduledAt).toEqual(storedScheduledAt);
      expect(repository.setRequest).not.toHaveBeenCalled();
      expect(repository.deleteSessions).not.toHaveBeenCalled();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
      expect(stripeSubscriptionApiService.cancelSubscription).not.toHaveBeenCalled();
    });
  });

  describe("findPreview", () => {
    it("runs describeImpact inside the target user's CLS", async () => {
      let seen: { userId?: string; companyId?: string } = {};
      handler!.describeImpact.mockImplementation(async () => {
        seen = { userId: cls.get("userId"), companyId: cls.get("companyId") };
        return { ownedCount: 2, otherTables: [] };
      });

      await asCaller(
        { userId: ADMIN_ID, companyId: ADMIN_COMPANY_ID, roles: [SystemRoles.Administrator] },
        async () => {
          await service.findPreview({ userId: USER_ID });
          // the caller's own context is untouched afterwards
          expect(cls.get("userId")).toBe(ADMIN_ID);
          expect(cls.get("companyId")).toBe(ADMIN_COMPANY_ID);
        },
      );

      expect(seen).toEqual({ userId: USER_ID, companyId: COMPANY_ID });
      expect(handler!.describeImpact).toHaveBeenCalledWith({
        userId: USER_ID,
        companyId: COMPANY_ID,
        deletesCompany: true,
      });
    });

    it.each([
      [{ companyId: COMPANY_ID, memberCount: 1 }, true],
      [{ companyId: COMPANY_ID, memberCount: 2 }, false],
      [{ companyId: null, memberCount: 0 }, false],
    ])("deletesCompany is true only when the user is the only member (%o)", async (summary, expected) => {
      repository.findMembershipSummary.mockResolvedValue(summary);

      const result: any = await asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
        service.findPreview({ userId: USER_ID }),
      );

      expect(result.data.deletesCompany).toBe(expected);
      expect(result.data.ownedCount).toBe(expected ? 3 : 0);
      expect(result.data.hasActiveSubscription).toBe(expected);
    });

    it("without an app handler reports no owned content and no other tables", async () => {
      handler = undefined;

      const result: any = await asCaller({ userId: USER_ID, companyId: COMPANY_ID }, () =>
        service.findPreview({ userId: USER_ID }),
      );

      expect(result.data.ownedCount).toBe(0);
      expect(result.data.otherTables).toEqual([]);
    });

    it("throws NotFoundException for an unknown user", async () => {
      repository.findTargetUser.mockResolvedValue(null);

      await expect(service.findPreview({ userId: USER_ID })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("keep", () => {
    it("valid token clears the request", async () => {
      repository.findByUndoTokenHash.mockResolvedValue(makeUser({ deletionScheduledAt: SEVEN_DAYS_LATER }));

      await service.keep({ token: "raw-token" });

      expect(repository.findByUndoTokenHash).toHaveBeenCalledWith({
        undoTokenHash: createHash("sha256").update("raw-token").digest("hex"),
      });
      expect(repository.clearRequest).toHaveBeenCalledWith({ userId: USER_ID });
    });

    it("unknown token throws NotFoundException", async () => {
      repository.findByUndoTokenHash.mockResolvedValue(null);

      await expect(service.keep({ token: "nope" })).rejects.toThrow(new NotFoundException("This link no longer works"));
      expect(repository.clearRequest).not.toHaveBeenCalled();
    });

    it("expired token throws NotFoundException", async () => {
      repository.findByUndoTokenHash.mockResolvedValue(makeUser({ deletionScheduledAt: NOW }));

      await expect(service.keep({ token: "late" })).rejects.toThrow(new NotFoundException("This link no longer works"));
      expect(repository.clearRequest).not.toHaveBeenCalled();
    });

    it("a repository failure gives the same answer", async () => {
      repository.findByUndoTokenHash.mockRejectedValue(new Error("db down"));

      await expect(service.keep({ token: "x" })).rejects.toThrow(new NotFoundException("This link no longer works"));
    });
  });

  describe("cancelOnLogin", () => {
    it("clears a pending request and returns true", async () => {
      repository.findTargetUser.mockResolvedValue(makeUser({ deletionScheduledAt: SEVEN_DAYS_LATER }));

      await expect(service.cancelOnLogin({ userId: USER_ID })).resolves.toBe(true);
      expect(repository.clearRequest).toHaveBeenCalledWith({ userId: USER_ID });
    });

    it("returns false when nothing is pending", async () => {
      await expect(service.cancelOnLogin({ userId: USER_ID })).resolves.toBe(false);
      expect(repository.clearRequest).not.toHaveBeenCalled();
    });
  });
});
