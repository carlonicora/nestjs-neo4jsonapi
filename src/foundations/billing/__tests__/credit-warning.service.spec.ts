import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";

vi.mock("../../company/repositories/company.repository", () => ({
  CompanyRepository: class CompanyRepository {},
}));
vi.mock("../../stripe-customer/repositories/stripe-customer.repository", () => ({
  StripeCustomerRepository: class StripeCustomerRepository {},
}));
vi.mock("../../stripe-subscription/repositories/stripe-subscription.repository", () => ({
  StripeSubscriptionRepository: class StripeSubscriptionRepository {},
}));
vi.mock("../../stripe-price/repositories/stripe-price.repository", () => ({
  StripePriceRepository: class StripePriceRepository {},
}));
vi.mock("../../stripe-webhook/services/stripe-webhook-notification.service", () => ({
  StripeWebhookNotificationService: class StripeWebhookNotificationService {},
}));
vi.mock("../../../core/websocket/services/websocket.service", () => ({
  WebSocketService: class WebSocketService {},
}));
vi.mock("../../../core/logging/services/logging.service", () => ({
  AppLoggingService: class AppLoggingService {},
}));

import { ClsService } from "nestjs-cls";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripePriceRepository } from "../../stripe-price/repositories/stripe-price.repository";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeWebhookNotificationService } from "../../stripe-webhook/services/stripe-webhook-notification.service";
import { BillingModuleConfig, resolveBillingConfig } from "../interfaces/billing.config.interface";
import { CreditWarningService } from "../services/credit-warning.service";

const COMPANY_ID = "c1";

const price = (overrides: Record<string, unknown> = {}) => ({
  id: "price-node",
  active: true,
  priceType: "recurring",
  recurringInterval: "month",
  token: 200,
  isTrial: false,
  ...overrides,
});

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub-node",
  status: "active",
  stripePrice: price(),
  ...overrides,
});

function setup(params: { config?: BillingModuleConfig; clsCompanyId?: string } = {}) {
  const store: Record<string, unknown> = { companyId: params.clsCompanyId ?? COMPANY_ID };

  const cls = {
    run: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    set: vi.fn((key: string, value: unknown) => {
      store[key] = value;
    }),
    get: vi.fn((key: string) => store[key]),
  } as unknown as Mocked<ClsService>;

  const companyRepository = {
    findByCompanyId: vi.fn().mockResolvedValue({ id: COMPANY_ID, creditsGrantedThisPeriod: 200 }),
    markCreditWarningSent: vi.fn().mockResolvedValue({ id: COMPANY_ID }),
    resetCreditWarningPeriod: vi.fn().mockResolvedValue(undefined),
    markCreditWarningDismissed: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<CompanyRepository>;

  const stripeCustomerRepository = {
    findByCompanyId: vi.fn().mockResolvedValue({ id: "cus-node", stripeCustomerId: "cus_1" }),
  } as unknown as Mocked<StripeCustomerRepository>;

  const stripeSubscriptionRepository = {
    findActiveByStripeCustomerId: vi.fn().mockResolvedValue([subscription()]),
  } as unknown as Mocked<StripeSubscriptionRepository>;

  const stripePriceRepository = {
    findAll: vi.fn().mockResolvedValue([price()]),
  } as unknown as Mocked<StripePriceRepository>;

  const notificationService = {
    sendCreditWarningEmail: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<StripeWebhookNotificationService>;

  const webSocketService = {
    sendMessageToCompany: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<WebSocketService>;

  const logger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() } as unknown as Mocked<AppLoggingService>;

  const service = new CreditWarningService(
    {} as any,
    companyRepository,
    cls,
    resolveBillingConfig(params.config ?? { creditWarning: { enabled: true } }),
    stripeCustomerRepository,
    stripeSubscriptionRepository,
    stripePriceRepository,
    notificationService,
    webSocketService,
    logger,
  );

  return {
    service,
    cls,
    companyRepository,
    stripeCustomerRepository,
    stripeSubscriptionRepository,
    stripePriceRepository,
    notificationService,
    webSocketService,
    logger,
  };
}

const used = (monthly: number, extra: number, companyId = COMPANY_ID) => ({
  companyId,
  availableMonthlyCredits: monthly,
  availableExtraCredits: extra,
});

describe("CreditWarningService", () => {
  describe("feature off", () => {
    it("does nothing when creditWarning is disabled", async () => {
      const ctx = setup({ config: {} });

      await ctx.service.handleCreditsUsed(used(10, 0));
      await ctx.service.handleCreditsGranted({ companyId: COMPANY_ID, grantedCredits: 200 });

      expect(ctx.cls.run).not.toHaveBeenCalled();
      expect(ctx.companyRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(ctx.companyRepository.markCreditWarningSent).not.toHaveBeenCalled();
      expect(ctx.companyRepository.resetCreditWarningPeriod).not.toHaveBeenCalled();
      expect(ctx.stripeCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(ctx.notificationService.sendCreditWarningEmail).not.toHaveBeenCalled();
      expect(ctx.webSocketService.sendMessageToCompany).not.toHaveBeenCalled();
    });

    it("dismiss writes nothing and does not throw", async () => {
      const ctx = setup({ config: { creditWarning: { enabled: false } } });

      await expect(ctx.service.dismiss({ companyId: "c2" })).resolves.toBeUndefined();

      expect(ctx.companyRepository.markCreditWarningDismissed).not.toHaveBeenCalled();
      expect(ctx.webSocketService.sendMessageToCompany).not.toHaveBeenCalled();
    });
  });

  describe("skips the lookup when the warning cannot fire", () => {
    const expectSkipped = (ctx: ReturnType<typeof setup>) => {
      expect(ctx.companyRepository.findByCompanyId).toHaveBeenCalledTimes(1);
      expect(ctx.companyRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: COMPANY_ID });
      expect(ctx.stripeCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(ctx.stripeSubscriptionRepository.findActiveByStripeCustomerId).not.toHaveBeenCalled();
      expect(ctx.companyRepository.markCreditWarningSent).not.toHaveBeenCalled();
      expect(ctx.notificationService.sendCreditWarningEmail).not.toHaveBeenCalled();
    };

    it("granted 200, 100 + 0 left (above the threshold)", async () => {
      const ctx = setup();
      await ctx.service.handleCreditsUsed(used(100, 0));
      expectSkipped(ctx);
    });

    it("already warned this period", async () => {
      const ctx = setup();
      ctx.companyRepository.findByCompanyId.mockResolvedValue({
        id: COMPANY_ID,
        creditsGrantedThisPeriod: 200,
        creditWarningSentAt: new Date("2026-10-20T10:00:00Z"),
      } as any);
      await ctx.service.handleCreditsUsed(used(30, 0));
      expectSkipped(ctx);
    });

    it("creditsGrantedThisPeriod absent", async () => {
      const ctx = setup();
      ctx.companyRepository.findByCompanyId.mockResolvedValue({ id: COMPANY_ID } as any);
      await ctx.service.handleCreditsUsed(used(0.5, 0));
      expectSkipped(ctx);
    });

    it("creditsGrantedThisPeriod 0", async () => {
      const ctx = setup();
      ctx.companyRepository.findByCompanyId.mockResolvedValue({ id: COMPANY_ID, creditsGrantedThisPeriod: 0 } as any);
      await ctx.service.handleCreditsUsed(used(0.5, 0));
      expectSkipped(ctx);
    });

    it("out of credits: 0 + 0", async () => {
      const ctx = setup();
      await ctx.service.handleCreditsUsed(used(0, 0));
      expectSkipped(ctx);
    });

    it("out of credits: 0 + -0.3", async () => {
      const ctx = setup();
      await ctx.service.handleCreditsUsed(used(0, -0.3));
      expectSkipped(ctx);
    });
  });

  describe("warns once", () => {
    it("sends the email with the resolved offer, then broadcasts", async () => {
      const ctx = setup();

      await ctx.service.handleCreditsUsed(used(30, 0));

      expect(ctx.companyRepository.markCreditWarningSent).toHaveBeenCalledWith({ thresholdPercent: 80, offer: "pack" });
      expect(ctx.notificationService.sendCreditWarningEmail).toHaveBeenCalledTimes(1);
      expect(ctx.notificationService.sendCreditWarningEmail).toHaveBeenCalledWith({
        stripeCustomerId: "cus_1",
        offer: "pack",
        interval: "month",
      });
      expect(ctx.webSocketService.sendMessageToCompany).toHaveBeenCalledWith(
        COMPANY_ID,
        "company:subscription_updated",
        { type: "company:subscription_updated", companyId: COMPANY_ID },
      );
      expect(ctx.notificationService.sendCreditWarningEmail.mock.invocationCallOrder[0]).toBeLessThan(
        ctx.webSocketService.sendMessageToCompany.mock.invocationCallOrder[0],
      );
    });

    it("sends nothing when markCreditWarningSent returns null (the other spend won)", async () => {
      const ctx = setup();
      ctx.companyRepository.markCreditWarningSent.mockResolvedValue(null);

      await ctx.service.handleCreditsUsed(used(30, 0));

      expect(ctx.companyRepository.markCreditWarningSent).toHaveBeenCalledTimes(1);
      expect(ctx.notificationService.sendCreditWarningEmail).not.toHaveBeenCalled();
      expect(ctx.webSocketService.sendMessageToCompany).not.toHaveBeenCalled();
    });

    it("warns at exactly the threshold (40 of 200 left)", async () => {
      const ctx = setup();

      await ctx.service.handleCreditsUsed(used(40, 0));

      expect(ctx.companyRepository.markCreditWarningSent).toHaveBeenCalledTimes(1);
    });

    it("never throws back into the emitter", async () => {
      const ctx = setup();
      ctx.companyRepository.markCreditWarningSent.mockRejectedValue(new Error("neo4j down"));

      await expect(ctx.service.handleCreditsUsed(used(30, 0))).resolves.toBeUndefined();

      expect(ctx.logger.warn).toHaveBeenCalled();
      expect(ctx.notificationService.sendCreditWarningEmail).not.toHaveBeenCalled();
    });
  });

  it("counts pack credits: granted 200, 0 + 50 left → no warning", async () => {
    const ctx = setup();

    await ctx.service.handleCreditsUsed(used(0, 50));

    expect(ctx.companyRepository.markCreditWarningSent).not.toHaveBeenCalled();
  });

  describe("offer", () => {
    it("trialing subscription → subscribe", async () => {
      const ctx = setup();
      ctx.stripeSubscriptionRepository.findActiveByStripeCustomerId.mockResolvedValue([
        subscription({ status: "trialing", stripePrice: price({ isTrial: true }) }),
      ] as any);

      expect(await ctx.service.resolveOffer()).toBe("subscribe");
      expect(ctx.stripeSubscriptionRepository.findActiveByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: "cus_1",
      });
    });

    it("a monthly 500 above the current monthly 200 → upgrade-or-pack", async () => {
      const ctx = setup();
      ctx.stripePriceRepository.findAll.mockResolvedValue([
        price({ id: "standard", token: 200 }),
        price({ id: "pro", token: 500 }),
      ] as any);

      expect(await ctx.service.resolveOffer()).toBe("upgrade-or-pack");
      expect(ctx.stripePriceRepository.findAll).toHaveBeenCalledWith({ active: true });
    });

    it("only a yearly 6000 above the current monthly 500 → pack", async () => {
      const ctx = setup();
      ctx.stripeSubscriptionRepository.findActiveByStripeCustomerId.mockResolvedValue([
        subscription({ stripePrice: price({ token: 500 }) }),
      ] as any);
      ctx.stripePriceRepository.findAll.mockResolvedValue([
        price({ id: "pro", token: 500 }),
        price({ id: "pro-yearly", token: 6000, recurringInterval: "year" }),
      ] as any);

      expect(await ctx.service.resolveOffer()).toBe("pack");
    });

    it("a bigger trial price does not count as an upgrade", async () => {
      const ctx = setup();
      ctx.stripePriceRepository.findAll.mockResolvedValue([
        price({ id: "standard", token: 200 }),
        price({ id: "trial", token: 1000, isTrial: true }),
      ] as any);

      expect(await ctx.service.resolveOffer()).toBe("pack");
    });

    it("no active recurring subscription → null and no warning", async () => {
      const ctx = setup();
      ctx.stripeSubscriptionRepository.findActiveByStripeCustomerId.mockResolvedValue([
        subscription({ stripePrice: price({ priceType: "one_time" }) }),
      ] as any);

      expect(await ctx.service.resolveOffer()).toBeNull();

      await ctx.service.handleCreditsUsed(used(30, 0));

      expect(ctx.companyRepository.markCreditWarningSent).not.toHaveBeenCalled();
      expect(ctx.notificationService.sendCreditWarningEmail).not.toHaveBeenCalled();
    });

    it("no Stripe customer → null", async () => {
      const ctx = setup();
      ctx.stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      expect(await ctx.service.resolveOffer()).toBeNull();
    });
  });

  describe("interval", () => {
    it("a yearly price → year", async () => {
      const ctx = setup();
      ctx.stripeSubscriptionRepository.findActiveByStripeCustomerId.mockResolvedValue([
        subscription({ stripePrice: price({ recurringInterval: "year", token: 2400 }) }),
      ] as any);
      ctx.companyRepository.findByCompanyId.mockResolvedValue({
        id: COMPANY_ID,
        creditsGrantedThisPeriod: 2400,
      } as any);

      await ctx.service.handleCreditsUsed(used(100, 0));

      expect(ctx.notificationService.sendCreditWarningEmail).toHaveBeenCalledWith(
        expect.objectContaining({ interval: "year" }),
      );
    });

    it("a monthly price → month", async () => {
      const ctx = setup();

      await ctx.service.handleCreditsUsed(used(30, 0));

      expect(ctx.notificationService.sendCreditWarningEmail).toHaveBeenCalledWith(
        expect.objectContaining({ interval: "month" }),
      );
    });
  });

  describe("CLS", () => {
    it("runs repository calls in the payload company's CLS", async () => {
      const ctx = setup({ clsCompanyId: "" });
      let companyInClsAtReset: unknown;
      ctx.companyRepository.resetCreditWarningPeriod.mockImplementation(async () => {
        companyInClsAtReset = ctx.cls.get("companyId");
      });

      await ctx.service.handleCreditsGranted({ companyId: "c9", grantedCredits: 500 });

      expect(ctx.cls.run).toHaveBeenCalledTimes(1);
      expect(ctx.cls.set).toHaveBeenCalledWith("companyId", "c9");
      expect(ctx.companyRepository.resetCreditWarningPeriod).toHaveBeenCalledWith({ grantedCredits: 500 });
      expect(companyInClsAtReset).toBe("c9");
    });

    it("credits-used runs inside cls.run with the payload company", async () => {
      const ctx = setup({ clsCompanyId: "" });

      await ctx.service.handleCreditsUsed(used(30, 0, "c7"));

      expect(ctx.cls.run).toHaveBeenCalledTimes(1);
      expect(ctx.cls.set).toHaveBeenCalledWith("companyId", "c7");
      expect(ctx.stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: "c7" });
    });

    it("a failed reset never throws back into the emitter", async () => {
      const ctx = setup();
      ctx.companyRepository.resetCreditWarningPeriod.mockRejectedValue(new Error("no company"));

      await expect(ctx.service.handleCreditsGranted({ companyId: "c9", grantedCredits: 500 })).resolves.toBeUndefined();
      expect(ctx.logger.warn).toHaveBeenCalled();
    });
  });

  describe("dismiss", () => {
    it("refuses another company", async () => {
      const ctx = setup();

      await expect(ctx.service.dismiss({ companyId: "c2" })).rejects.toBeInstanceOf(ForbiddenException);

      expect(ctx.companyRepository.markCreditWarningDismissed).not.toHaveBeenCalled();
      expect(ctx.webSocketService.sendMessageToCompany).not.toHaveBeenCalled();
    });

    it("dismisses the caller's company and broadcasts", async () => {
      const ctx = setup();

      await ctx.service.dismiss({ companyId: COMPANY_ID });

      expect(ctx.companyRepository.markCreditWarningDismissed).toHaveBeenCalledTimes(1);
      expect(ctx.webSocketService.sendMessageToCompany).toHaveBeenCalledWith(
        COMPANY_ID,
        "company:subscription_updated",
        { type: "company:subscription_updated", companyId: COMPANY_ID },
      );
    });

    it("a failed broadcast is logged, never thrown", async () => {
      const ctx = setup();
      ctx.webSocketService.sendMessageToCompany.mockRejectedValue(new Error("redis down"));

      await expect(ctx.service.dismiss({ companyId: COMPANY_ID })).resolves.toBeUndefined();
      expect(ctx.logger.warn).toHaveBeenCalled();
    });
  });
});
