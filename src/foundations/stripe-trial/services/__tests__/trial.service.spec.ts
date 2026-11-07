import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ModuleRef } from "@nestjs/core";
import { TrialService } from "../trial.service";
import { CompanyRepository } from "../../../company/repositories/company.repository";
import { CompanyService } from "../../../company/services/company.service";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { StripeCustomerAdminService } from "../../../stripe-customer/services/stripe-customer-admin.service";
import { StripeSubscriptionAdminService } from "../../../stripe-subscription/services/stripe-subscription-admin.service";
import { StripePriceRepository } from "../../../stripe-price/repositories/stripe-price.repository";
import { StripeCustomerRepository } from "../../../stripe-customer/repositories/stripe-customer.repository";
import { StripeSubscriptionRepository } from "../../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeSubscriptionApiService } from "../../../stripe-subscription/services/stripe-subscription-api.service";
import { FeatureSyncService } from "../../../stripe-subscription/services/feature-sync.service";
import { TEST_IDS } from "../../../stripe/__tests__/fixtures/stripe.fixtures";

const MOCK_COMPANY = {
  id: TEST_IDS.companyId,
  name: "Test Company",
  isActiveSubscription: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_COMPANY_WITH_SUBSCRIPTION = {
  ...MOCK_COMPANY,
  isActiveSubscription: true,
};

const MOCK_TRIAL_PRICE = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  stripePriceId: "price_test_trial",
  active: true,
  isTrial: true,
  priceType: "recurring" as const,
  currency: "usd",
  unitAmount: 0,
  token: 10000,
};

const MOCK_TRIAL_PRICE_NO_TOKENS = {
  ...MOCK_TRIAL_PRICE,
  token: null,
};

const MOCK_CUSTOMER_ENTITY = {
  id: "660e8400-e29b-41d4-a716-446655440001",
  stripeCustomerId: TEST_IDS.customerId,
  email: "test@example.com",
  name: "Test Company",
};

const MOCK_USER_ID = "770e8400-e29b-41d4-a716-446655440002";

// Factory functions for mocks
const createMockCompanyRepository = () => ({
  findByCompanyId: vi.fn(),
  updateTokens: vi.fn(),
  markSubscriptionStatus: vi.fn(),
  markTrialEnd: vi.fn(),
  replaceTrialEnd: vi.fn(),
});

const createMockCompanyService = () => ({
  updateTokensAndAiFlag: vi.fn(),
});

const createMockLoggingService = () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  verbose: vi.fn(),
});

const createMockStripeCustomerAdminService = () => ({
  createCustomer: vi.fn(),
  getCustomerByCompanyId: vi.fn(),
  getCustomerById: vi.fn(),
  getCustomerByStripeId: vi.fn(),
  updateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  syncFromStripe: vi.fn(),
});

const createMockStripeSubscriptionAdminService = () => ({
  createSubscription: vi.fn(),
  getSubscriptionByCompanyId: vi.fn(),
  getSubscriptionById: vi.fn(),
  updateSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
});

const createMockStripePriceRepository = () => ({
  findTrialPrice: vi.fn(),
  findById: vi.fn(),
  findByStripePriceId: vi.fn(),
  findAll: vi.fn(),
});

const createMockStripeCustomerRepository = () => ({
  findByCompanyId: vi.fn(),
  findById: vi.fn(),
  findByStripeCustomerId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
});

const createMockStripeSubscriptionRepository = () => ({
  findByStripeCustomerId: vi.fn().mockResolvedValue([]),
  deleteByStripeSubscriptionId: vi.fn(),
});

const createMockStripeSubscriptionApiService = () => ({
  cancelUnpaidAttempt: vi.fn(),
});

const createMockFeatureSyncService = () => ({
  syncFeaturesOnPayment: vi.fn().mockResolvedValue({ success: true, featuresAdded: [] }),
});

describe("TrialService", () => {
  let service: TrialService;
  let companyRepository: ReturnType<typeof createMockCompanyRepository>;
  let companyService: ReturnType<typeof createMockCompanyService>;
  let logger: ReturnType<typeof createMockLoggingService>;
  let stripeCustomerAdminService: ReturnType<typeof createMockStripeCustomerAdminService>;
  let stripeSubscriptionAdminService: ReturnType<typeof createMockStripeSubscriptionAdminService>;
  let stripePriceRepository: ReturnType<typeof createMockStripePriceRepository>;
  let stripeCustomerRepository: ReturnType<typeof createMockStripeCustomerRepository>;
  let stripeSubscriptionRepository: ReturnType<typeof createMockStripeSubscriptionRepository>;
  let stripeSubscriptionApiService: ReturnType<typeof createMockStripeSubscriptionApiService>;
  let featureSyncService: ReturnType<typeof createMockFeatureSyncService>;
  let moduleRef: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    companyRepository = createMockCompanyRepository();
    companyService = createMockCompanyService();
    logger = createMockLoggingService();
    stripeCustomerAdminService = createMockStripeCustomerAdminService();
    stripeSubscriptionAdminService = createMockStripeSubscriptionAdminService();
    stripePriceRepository = createMockStripePriceRepository();
    stripeCustomerRepository = createMockStripeCustomerRepository();
    stripeSubscriptionRepository = createMockStripeSubscriptionRepository();
    stripeSubscriptionApiService = createMockStripeSubscriptionApiService();
    featureSyncService = createMockFeatureSyncService();

    // Mock ModuleRef to return our mocked services
    moduleRef = {
      get: vi.fn((token) => {
        if (token === StripeCustomerAdminService) return stripeCustomerAdminService;
        if (token === StripeSubscriptionAdminService) return stripeSubscriptionAdminService;
        if (token === StripePriceRepository) return stripePriceRepository;
        if (token === StripeCustomerRepository) return stripeCustomerRepository;
        if (token === StripeSubscriptionRepository) return stripeSubscriptionRepository;
        if (token === StripeSubscriptionApiService) return stripeSubscriptionApiService;
        if (token === FeatureSyncService) return featureSyncService;
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrialService,
        { provide: ModuleRef, useValue: moduleRef },
        { provide: CompanyRepository, useValue: companyRepository },
        { provide: CompanyService, useValue: companyService },
        { provide: AppLoggingService, useValue: logger },
      ],
    }).compile();

    service = module.get<TrialService>(TrialService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("startTrial", () => {
    const trialParams = {
      companyId: TEST_IDS.companyId,
      userId: MOCK_USER_ID,
    };

    it("should successfully start a trial for a new company", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyService.updateTokensAndAiFlag.mockResolvedValue(undefined);
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial(trialParams);

      expect(companyRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: trialParams.companyId });
      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: trialParams.companyId });
      expect(stripePriceRepository.findTrialPrice).toHaveBeenCalled();
      expect(stripeCustomerAdminService.createCustomer).toHaveBeenCalledWith(trialParams.companyId, trialParams.userId);
      expect(stripeSubscriptionAdminService.createSubscription).toHaveBeenCalledWith({
        companyId: trialParams.companyId,
        priceId: MOCK_TRIAL_PRICE.id,
        trialPeriodDays: 14,
      });
      expect(companyService.updateTokensAndAiFlag).toHaveBeenCalledWith({
        companyId: trialParams.companyId,
        monthlyCredits: MOCK_TRIAL_PRICE.token,
        availableMonthlyCredits: MOCK_TRIAL_PRICE.token,
        aiEnabled: true,
      });
      expect(companyRepository.markSubscriptionStatus).toHaveBeenCalledWith({
        companyId: trialParams.companyId,
        isActiveSubscription: true,
      });
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("Trial started"));
    });

    it("writes trialEndsAt 14 days after start", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-26T10:00:00.000Z"));
      try {
        companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
        stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
        stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);
        stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
        stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
        companyService.updateTokensAndAiFlag.mockResolvedValue(undefined);
        companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);
        companyRepository.markTrialEnd.mockResolvedValue(undefined);

        await service.startTrial(trialParams);

        expect(companyRepository.markTrialEnd).toHaveBeenCalledWith({
          companyId: trialParams.companyId,
          trialEndsAt: "2026-11-09T10:00:00.000Z",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not write trialEndsAt when the trial is skipped", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY);
      stripeSubscriptionRepository.findByStripeCustomerId.mockResolvedValue([{ status: "trialing" }]);

      await service.startTrial(trialParams);

      expect(companyRepository.markTrialEnd).not.toHaveBeenCalled();
    });

    it("should skip trial creation when company already has active subscription", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY_WITH_SUBSCRIPTION);

      await service.startTrial(trialParams);

      expect(companyRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: trialParams.companyId });
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("already has active subscription"));
      expect(stripeCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(stripePriceRepository.findTrialPrice).not.toHaveBeenCalled();
      expect(stripeCustomerAdminService.createCustomer).not.toHaveBeenCalled();
    });

    it("startTrial reuses an existing Stripe customer that has no subscription", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY);
      stripeSubscriptionRepository.findByStripeCustomerId.mockResolvedValue([]);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });

      await service.startTrial(trialParams);

      expect(stripeSubscriptionRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_CUSTOMER_ENTITY.id,
      });
      expect(stripeCustomerAdminService.createCustomer).not.toHaveBeenCalled();
      expect(stripeSubscriptionAdminService.createSubscription).toHaveBeenCalledTimes(1);
    });

    it("startTrial skips when a counting subscription exists", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY);
      stripeSubscriptionRepository.findByStripeCustomerId.mockResolvedValue([
        { status: "canceled", trialEnd: new Date("2026-10-01T00:00:00.000Z") },
      ]);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);

      await service.startTrial(trialParams);

      expect(stripeCustomerAdminService.createCustomer).not.toHaveBeenCalled();
      expect(stripeSubscriptionAdminService.createSubscription).not.toHaveBeenCalled();
      expect(companyService.updateTokensAndAiFlag).not.toHaveBeenCalled();
      expect(companyRepository.markSubscriptionStatus).not.toHaveBeenCalled();
      expect(companyRepository.markTrialEnd).not.toHaveBeenCalled();
    });

    it("should skip trial creation when no trial price is configured", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(null);

      await service.startTrial(trialParams);

      expect(stripePriceRepository.findTrialPrice).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith("No trial price configured - skipping trial creation");
      expect(stripeCustomerAdminService.createCustomer).not.toHaveBeenCalled();
      expect(stripeSubscriptionAdminService.createSubscription).not.toHaveBeenCalled();
    });

    it("writes aiEnabled false when trial price has no tokens (undefined)", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE_NO_TOKENS);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyService.updateTokensAndAiFlag.mockResolvedValue(undefined);
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial(trialParams);

      expect(companyService.updateTokensAndAiFlag).toHaveBeenCalledWith(
        expect.objectContaining({ aiEnabled: false, monthlyCredits: 0 }),
      );
      expect(companyRepository.markSubscriptionStatus).toHaveBeenCalledWith({
        companyId: trialParams.companyId,
        isActiveSubscription: true,
      });
    });

    it("writes aiEnabled false for a zero-token trial price", async () => {
      const priceWithZeroTokens = { ...MOCK_TRIAL_PRICE, token: 0 };
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(priceWithZeroTokens);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyService.updateTokensAndAiFlag.mockResolvedValue(undefined);
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial(trialParams);

      expect(companyService.updateTokensAndAiFlag).toHaveBeenCalledWith(expect.objectContaining({ aiEnabled: false }));
    });

    it("should continue with trial when company has no subscription", async () => {
      const companyWithNullSubscription = { ...MOCK_COMPANY, isActiveSubscription: null };
      companyRepository.findByCompanyId.mockResolvedValue(companyWithNullSubscription);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyService.updateTokensAndAiFlag.mockResolvedValue(undefined);
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial(trialParams);

      expect(stripeCustomerAdminService.createCustomer).toHaveBeenCalled();
      expect(stripeSubscriptionAdminService.createSubscription).toHaveBeenCalled();
    });

    it("should continue with trial when company findByCompanyId returns null", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(null);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyService.updateTokensAndAiFlag.mockResolvedValue(undefined);
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial(trialParams);

      expect(stripeCustomerAdminService.createCustomer).toHaveBeenCalled();
      expect(stripeSubscriptionAdminService.createSubscription).toHaveBeenCalled();
    });
  });

  describe("startTrialInRequest", () => {
    const TRIAL_END = new Date("2026-11-21T10:00:00.000Z");
    const IDEMPOTENCY_KEY = "wyrdli-trial-co-1-2026-11-07T10:00:00.000Z";
    const requestParams = {
      companyId: TEST_IDS.companyId,
      userId: MOCK_USER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    const arrangeStart = (status: string) => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({
        data: { data: { id: "local-sub" } },
        subscription: { status, trialEnd: TRIAL_END, stripeSubscriptionId: "sub_1" },
      });
    };

    const expectNoWrites = () => {
      expect(companyService.updateTokensAndAiFlag).not.toHaveBeenCalled();
      expect(companyRepository.markSubscriptionStatus).not.toHaveBeenCalled();
      expect(companyRepository.replaceTrialEnd).not.toHaveBeenCalled();
      expect(companyRepository.markTrialEnd).not.toHaveBeenCalled();
    };

    it("startTrialInRequest returns trialing and writes credits, isActiveSubscription and the trial end", async () => {
      arrangeStart("trialing");

      const result = await service.startTrialInRequest(requestParams);

      expect(result).toEqual({ kind: "trialing", trialEndsAt: TRIAL_END });
      expect(companyService.updateTokensAndAiFlag).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        monthlyCredits: MOCK_TRIAL_PRICE.token,
        availableMonthlyCredits: MOCK_TRIAL_PRICE.token,
        aiEnabled: true,
      });
      expect(companyRepository.markSubscriptionStatus).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        isActiveSubscription: true,
      });
      expect(companyRepository.replaceTrialEnd).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        trialEndsAt: TRIAL_END.toISOString(),
      });
      expect(companyRepository.markTrialEnd).not.toHaveBeenCalled();
    });

    it("startTrialInRequest syncs the trial price features before answering trialing", async () => {
      arrangeStart("trialing");

      await service.startTrialInRequest(requestParams);

      expect(featureSyncService.syncFeaturesOnPayment).toHaveBeenCalledWith({ stripeSubscriptionId: "sub_1" });
      expect(featureSyncService.syncFeaturesOnPayment.mock.invocationCallOrder[0]).toBeGreaterThan(
        companyRepository.replaceTrialEnd.mock.invocationCallOrder[0],
      );
    });

    it("startTrialInRequest still answers trialing when the feature sync fails (the webhook syncs later)", async () => {
      arrangeStart("trialing");
      featureSyncService.syncFeaturesOnPayment.mockRejectedValue(new Error("neo4j down"));

      const result = await service.startTrialInRequest(requestParams);

      expect(result).toEqual({ kind: "trialing", trialEndsAt: TRIAL_END });
      expect(logger.error).toHaveBeenCalled();
    });

    it("startTrialInRequest never syncs features for a non-trialing subscription", async () => {
      arrangeStart("incomplete");

      await service.startTrialInRequest(requestParams);

      expect(featureSyncService.syncFeaturesOnPayment).not.toHaveBeenCalled();
    });

    it("startTrialInRequest cancels and deletes a non-trialing subscription", async () => {
      arrangeStart("incomplete");

      const result = await service.startTrialInRequest(requestParams);

      expect(result).toEqual({ kind: "not-trialing", status: "incomplete" });
      expect(stripeSubscriptionApiService.cancelUnpaidAttempt).toHaveBeenCalledWith("sub_1");
      expect(stripeSubscriptionRepository.deleteByStripeSubscriptionId).toHaveBeenCalledWith({
        stripeSubscriptionId: "sub_1",
      });
      expectNoWrites();
    });

    it("startTrialInRequest returns no-trial-price when none is configured", async () => {
      arrangeStart("trialing");
      stripePriceRepository.findTrialPrice.mockResolvedValue(null);

      const result = await service.startTrialInRequest(requestParams);

      expect(result).toEqual({ kind: "no-trial-price" });
      expect(stripeCustomerAdminService.createCustomer).not.toHaveBeenCalled();
      expect(stripeSubscriptionAdminService.createSubscription).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it("startTrialInRequest returns already-subscribed when a counting subscription exists", async () => {
      arrangeStart("trialing");
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY);
      stripeSubscriptionRepository.findByStripeCustomerId.mockResolvedValue([{ status: "active" }]);

      const result = await service.startTrialInRequest(requestParams);

      expect(result).toEqual({ kind: "already-subscribed" });
      expect(stripeSubscriptionAdminService.createSubscription).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it("startTrialInRequest returns already-subscribed when the company has an active subscription", async () => {
      arrangeStart("trialing");
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY_WITH_SUBSCRIPTION);

      const result = await service.startTrialInRequest(requestParams);

      expect(result).toEqual({ kind: "already-subscribed" });
      expect(stripeSubscriptionAdminService.createSubscription).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it("startTrialInRequest rethrows a Stripe error", async () => {
      arrangeStart("trialing");
      const stripeError = new Error("card_declined");
      stripeSubscriptionAdminService.createSubscription.mockRejectedValue(stripeError);

      await expect(service.startTrialInRequest(requestParams)).rejects.toBe(stripeError);
      expectNoWrites();
    });

    it("startTrialInRequest passes the idempotency key to Stripe", async () => {
      arrangeStart("trialing");

      await service.startTrialInRequest(requestParams);

      expect(stripeSubscriptionAdminService.createSubscription).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        priceId: MOCK_TRIAL_PRICE.id,
        trialPeriodDays: 14,
        idempotencyKey: IDEMPOTENCY_KEY,
      });
    });

    it("startTrialInRequest reuses an existing Stripe customer", async () => {
      arrangeStart("trialing");
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY);

      await service.startTrialInRequest(requestParams);

      expect(stripeCustomerAdminService.createCustomer).not.toHaveBeenCalled();
      expect(stripeSubscriptionAdminService.createSubscription).toHaveBeenCalledTimes(1);
    });
  });

  describe("Lazy Loading via ModuleRef", () => {
    it("should lazily load StripeCustomerAdminService via ModuleRef", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyService.updateTokensAndAiFlag.mockResolvedValue(undefined);
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial({
        companyId: TEST_IDS.companyId,
        userId: MOCK_USER_ID,
      });

      expect(moduleRef.get).toHaveBeenCalledWith(StripeCustomerAdminService, { strict: false });
      expect(moduleRef.get).toHaveBeenCalledWith(StripeSubscriptionAdminService, { strict: false });
      expect(moduleRef.get).toHaveBeenCalledWith(StripePriceRepository, { strict: false });
      expect(moduleRef.get).toHaveBeenCalledWith(StripeCustomerRepository, { strict: false });
    });
  });

  describe("Edge Cases", () => {
    it("should handle company with isActiveSubscription as false explicitly", async () => {
      const companyWithExplicitFalse = { ...MOCK_COMPANY, isActiveSubscription: false };
      companyRepository.findByCompanyId.mockResolvedValue(companyWithExplicitFalse);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyService.updateTokensAndAiFlag.mockResolvedValue(undefined);
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial({
        companyId: TEST_IDS.companyId,
        userId: MOCK_USER_ID,
      });

      expect(stripeCustomerAdminService.createCustomer).toHaveBeenCalled();
    });

    it("should log correct token count in success message", async () => {
      const priceWith5000Tokens = { ...MOCK_TRIAL_PRICE, token: 5000 };
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(priceWith5000Tokens);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyService.updateTokensAndAiFlag.mockResolvedValue(undefined);
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial({
        companyId: TEST_IDS.companyId,
        userId: MOCK_USER_ID,
      });

      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("5000 tokens"));
    });
  });
});
