import { describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { ConfigService } from "@nestjs/config";
import { Job } from "bullmq";
import { EmailService } from "../../../core/email/services/email.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { BillingModuleConfig, resolveBillingConfig } from "../interfaces/billing.config.interface";
import { BillingEmailJobData } from "../processors/billing-email.jobs";
import { BillingEmailProcessor } from "../processors/billing-email.processor";

// A fixed instant and the en / it strings formatEmailDate renders for it.
const FIXED_DATE = "2026-11-05T10:00:00Z";
const FIXED_DATE_EN = "5 November 2026";
const FIXED_DATE_IT = "5 novembre 2026";

const APP_URL = "https://app.example.com";

function setup(params: { config?: BillingModuleConfig; appUrl?: string } = {}) {
  const emailService = { sendEmail: vi.fn().mockResolvedValue(undefined) } as unknown as Mocked<EmailService>;
  const logger = {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as Mocked<AppLoggingService>;
  const configService = {
    get: vi.fn((key: string) => (key === "app" ? { url: params.appUrl ?? APP_URL } : undefined)),
  } as unknown as ConfigService;

  const processor = new BillingEmailProcessor(emailService, logger, configService, resolveBillingConfig(params.config));
  return { processor, emailService, logger };
}

function job(jobType: string, payload: Record<string, unknown>): Job<BillingEmailJobData> {
  return { id: "job_123", data: { jobType, payload }, failedReason: undefined } as unknown as Job<BillingEmailJobData>;
}

describe("BillingEmailProcessor", () => {
  it("payment-failure → paymentFailure with updatePaymentUrl = appUrl + links.paymentMethod and keepsAccess passed through", async () => {
    const { processor, emailService } = setup({ config: { links: { paymentMethod: "/billing/payment-method" } } });

    await processor.process(
      job("payment-failure", {
        to: "gm@example.com",
        customerName: "Ada",
        stripeCustomerId: "cus_1",
        stripeInvoiceId: "in_1",
        amount: 9.99,
        currency: "eur",
        errorMessage: "Card declined",
        invoiceUrl: "https://invoice",
        invoiceNumber: "INV-1",
        keepsAccess: true,
        locale: "it",
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "paymentFailure",
      expect.objectContaining({
        to: "gm@example.com",
        customerName: "Ada",
        stripeInvoiceId: "in_1",
        amount: 9.99,
        currency: "eur",
        errorMessage: "Card declined",
        invoiceUrl: "https://invoice",
        invoiceNumber: "INV-1",
        updatePaymentUrl: `${APP_URL}/billing/payment-method`,
        keepsAccess: true,
        locale: "it",
      }),
      "it",
    );
  });

  it("payment-failure without keepsAccess sends keepsAccess false", async () => {
    const { processor, emailService } = setup();

    await processor.process(
      job("payment-failure", { to: "gm@example.com", customerName: "Ada", stripeCustomerId: "cus_1" }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "paymentFailure",
      expect.objectContaining({ keepsAccess: false, updatePaymentUrl: `${APP_URL}/settings/billing` }),
      "en",
    );
  });

  it("subscription-status-change → subscriptionStatusChange with dashboardUrl = appUrl + links.billing", async () => {
    const { processor, emailService } = setup();

    await processor.process(
      job("subscription-status-change", {
        to: "gm@example.com",
        customerName: "Ada",
        stripeCustomerId: "cus_1",
        subscriptionId: "sub_1",
        status: "past_due",
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "subscriptionStatusChange",
      expect.objectContaining({
        subscriptionId: "sub_1",
        status: "past_due",
        dashboardUrl: `${APP_URL}/settings/billing`,
      }),
      "en",
    );
  });

  it("payment-success-customer → paymentSuccessCustomer with upper-cased currency and billingDashboardUrl", async () => {
    const { processor, emailService } = setup({ config: { links: { billing: "/billing" } } });

    await processor.process(
      job("payment-success-customer", {
        to: "gm@example.com",
        customerName: "Ada",
        stripeCustomerId: "cus_1",
        amount: 12,
        currency: "eur",
        isOneTimePurchase: false,
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "paymentSuccessCustomer",
      expect.objectContaining({
        amount: 12,
        currency: "EUR",
        isOneTimePurchase: false,
        billingDashboardUrl: `${APP_URL}/billing`,
      }),
      "en",
    );
  });

  it("payment-success-admin → paymentSuccessAdmin with USD fallback currency", async () => {
    const { processor, emailService } = setup();

    await processor.process(
      job("payment-success-admin", {
        to: "admin@example.com",
        adminName: "Root",
        companyName: "Acme",
        amount: 12,
        isOneTimePurchase: true,
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "paymentSuccessAdmin",
      expect.objectContaining({ adminName: "Root", companyName: "Acme", currency: "USD", isOneTimePurchase: true }),
      "en",
    );
  });

  it("trial-ending-reminder → upgradeUrl = appUrl + links.subscribe", async () => {
    const { processor, emailService } = setup();

    await processor.process(
      job("trial-ending-reminder", {
        to: "gm@example.com",
        customerName: "Ada",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        trialEndDate: FIXED_DATE,
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "trialEndingReminder",
      expect.objectContaining({
        trialEndDate: FIXED_DATE_EN,
        upgradeUrl: `${APP_URL}/settings/billing?action=subscribe`,
      }),
      "en",
    );
  });

  it("trial-ended → trialEndedWithoutPayment with upgradeUrl = appUrl + links.resubscribe", async () => {
    const { processor, emailService } = setup({ config: { links: { resubscribe: "/come-back" } } });

    await processor.process(
      job("trial-ended", {
        to: "gm@example.com",
        customerName: "Ada",
        companyName: "Acme",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        trialEndDate: FIXED_DATE,
        dataRemovalDate: FIXED_DATE,
        locale: "it",
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "trialEndedWithoutPayment",
      expect.objectContaining({
        companyName: "Acme",
        trialEndDate: FIXED_DATE_IT,
        dataRemovalDate: FIXED_DATE_IT,
        upgradeUrl: `${APP_URL}/come-back`,
      }),
      "it",
    );
  });

  it("deletion-warning → deletionWarning with only35's subject logic and resubscribeUrl", async () => {
    const { processor, emailService } = setup();

    await processor.process(
      job("deletion-warning", {
        to: "gm@example.com",
        companyName: "Acme",
        daysRemaining: 1,
        deletionDate: FIXED_DATE,
        reason: "subscription_cancelled",
        isTrialExpired: false,
        isSubscriptionCancelled: true,
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "deletionWarning",
      expect.objectContaining({
        subject: "Final Warning: Your Acme data will be deleted tomorrow",
        daysRemaining: 1,
        deletionDate: FIXED_DATE_EN,
        isFinalWarning: true,
        isSubscriptionCancelled: true,
        resubscribeUrl: `${APP_URL}/settings/billing`,
      }),
      "en",
    );

    await processor.process(
      job("deletion-warning", {
        to: "gm@example.com",
        companyName: "Acme",
        daysRemaining: 7,
        deletionDate: FIXED_DATE,
        reason: "trial_expired",
        isTrialExpired: true,
        isSubscriptionCancelled: false,
      }),
    );

    expect(emailService.sendEmail).toHaveBeenLastCalledWith(
      "deletionWarning",
      expect.objectContaining({
        subject: "Warning: Your Acme data will be deleted in 7 days",
        isFinalWarning: false,
      }),
      "en",
    );
  });

  it("subscription-cancelled → subscriptionCancelled with dataRemovalDate formatted and resubscribeUrl", async () => {
    const { processor, emailService } = setup();

    await processor.process(
      job("subscription-cancelled", { to: "gm@example.com", companyName: "Acme", dataRemovalDate: FIXED_DATE }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "subscriptionCancelled",
      expect.objectContaining({
        companyName: "Acme",
        dataRemovalDate: FIXED_DATE_EN,
        resubscribeUrl: `${APP_URL}/settings/billing`,
      }),
      "en",
    );
  });

  it("company-deleted → companyDeleted with reason flags", async () => {
    const { processor, emailService } = setup();

    await processor.process(
      job("company-deleted", {
        to: "gm@example.com",
        companyName: "Acme",
        reason: "immediate_deletion",
        deletionDate: FIXED_DATE,
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "companyDeleted",
      expect.objectContaining({
        deletionDate: FIXED_DATE_EN,
        isTrialExpired: false,
        isSubscriptionCancelled: false,
        isImmediateDeletion: true,
      }),
      "en",
    );
  });

  it("referral-invite → referralInvite with the payload's referralUrl", async () => {
    const { processor, emailService } = setup();

    await processor.process(
      job("referral-invite", {
        to: "friend@example.com",
        referralCode: "ABC",
        companyName: "Acme",
        inviterName: "Ada",
        inviterEmail: "gm@example.com",
        referralUrl: "https://app.example.com/r/ABC",
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "referralInvite",
      expect.objectContaining({
        referralCode: "ABC",
        inviterName: "Ada",
        referralUrl: "https://app.example.com/r/ABC",
      }),
      "en",
    );
  });

  it("referral-reward → referralReward", async () => {
    const { processor, emailService } = setup();

    await processor.process(job("referral-reward", { to: "gm@example.com", userName: "Ada", tokensAwarded: 100 }));

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "referralReward",
      expect.objectContaining({ userName: "Ada", tokensAwarded: 100 }),
      "en",
    );
  });

  it("card-expiring → cardExpiring with renewalDate formatted by formatEmailDate", async () => {
    const { processor, emailService } = setup();

    await processor.process(
      job("card-expiring", {
        to: "gm@example.com",
        customerName: "Ada",
        stripeCustomerId: "cus_1",
        renewalDate: FIXED_DATE,
        cardBrand: "visa",
        cardLast4: "4242",
        locale: "it",
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "cardExpiring",
      expect.objectContaining({
        to: "gm@example.com",
        customerName: "Ada",
        renewalDate: FIXED_DATE_IT,
        cardBrand: "visa",
        cardLast4: "4242",
        updatePaymentUrl: `${APP_URL}/settings/billing`,
      }),
      "it",
    );
  });

  it("maps credit-warning → creditWarning with the offer flags, isYearly and both links", async () => {
    const { processor, emailService } = setup({
      config: { links: { changePlan: "/settings?section=billing&action=change-plan" } },
    });

    await processor.process(
      job("credit-warning", {
        to: "gm@example.com",
        customerName: "Ada",
        offer: "upgrade-or-pack",
        interval: "year",
        locale: "it",
      }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "creditWarning",
      expect.objectContaining({
        to: "gm@example.com",
        customerName: "Ada",
        offerSubscribe: false,
        offerUpgrade: true,
        offerPack: false,
        isYearly: true,
        changePlanUrl: `${APP_URL}/settings?section=billing&action=change-plan`,
        buyCreditsUrl: `${APP_URL}/settings/billing?action=subscribe`,
        locale: "it",
      }),
      "it",
    );
  });

  it("maps credit-warning offers subscribe and pack, monthly", async () => {
    const { processor, emailService } = setup();

    await processor.process(
      job("credit-warning", {
        to: "gm@example.com",
        customerName: "Ada",
        offer: "subscribe",
        interval: "month",
        locale: "en",
      }),
    );
    expect(emailService.sendEmail).toHaveBeenLastCalledWith(
      "creditWarning",
      expect.objectContaining({ offerSubscribe: true, offerUpgrade: false, offerPack: false, isYearly: false }),
      "en",
    );

    await processor.process(
      job("credit-warning", {
        to: "gm@example.com",
        customerName: "Ada",
        offer: "pack",
        interval: "month",
        locale: "en",
      }),
    );
    expect(emailService.sendEmail).toHaveBeenLastCalledWith(
      "creditWarning",
      expect.objectContaining({ offerSubscribe: false, offerUpgrade: false, offerPack: true }),
      "en",
    );
  });

  it("extra job → uses the app's definition", async () => {
    const toTemplateData = vi.fn((payload: Record<string, unknown>) => ({ cullName: payload.cullName }));
    const { processor, emailService } = setup({
      config: {
        emailSender: { enabled: true, extraJobs: { "cull-completed": { template: "cullCompleted", toTemplateData } } },
      },
    });

    await processor.process(job("cull-completed", { to: "gm@example.com", cullName: "Autumn", locale: "it" }));

    expect(toTemplateData).toHaveBeenCalledWith(
      expect.objectContaining({ cullName: "Autumn" }),
      expect.objectContaining({ appUrl: APP_URL, locale: "it", links: expect.any(Object) }),
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "cullCompleted",
      { to: "gm@example.com", cullName: "Autumn" },
      "it",
    );
  });

  it("unknown job → warns, sends nothing", async () => {
    const { processor, emailService, logger } = setup();

    await processor.process(job("no-such-job", { to: "gm@example.com" }));

    expect(logger.warn).toHaveBeenCalledWith("Unknown email job type: no-such-job");
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it("strips the trailing slash of APP_URL", async () => {
    const { processor, emailService } = setup({ appUrl: "https://app.example.com/" });

    await processor.process(
      job("subscription-cancelled", { to: "gm@example.com", companyName: "Acme", dataRemovalDate: FIXED_DATE }),
    );

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      "subscriptionCancelled",
      expect.objectContaining({ resubscribeUrl: "https://app.example.com/settings/billing" }),
      "en",
    );
  });
});
