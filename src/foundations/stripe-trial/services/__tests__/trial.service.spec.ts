import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ModuleRef } from "@nestjs/core";
import { TrialService } from "../trial.service";
import { CompanyRepository } from "../../../company/repositories/company.repository";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import { StripeCustomerAdminService } from "../../../stripe-customer/services/stripe-customer-admin.service";
import { StripeSubscriptionAdminService } from "../../../stripe-subscription/services/stripe-subscription-admin.service";
import { StripePriceRepository } from "../../../stripe-price/repositories/stripe-price.repository";
import { StripeCustomerRepository } from "../../../stripe-customer/repositories/stripe-customer.repository";
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

describe("TrialService", () => {
  let service: TrialService;
  let companyRepository: ReturnType<typeof createMockCompanyRepository>;
  let logger: ReturnType<typeof createMockLoggingService>;
  let stripeCustomerAdminService: ReturnType<typeof createMockStripeCustomerAdminService>;
  let stripeSubscriptionAdminService: ReturnType<typeof createMockStripeSubscriptionAdminService>;
  let stripePriceRepository: ReturnType<typeof createMockStripePriceRepository>;
  let stripeCustomerRepository: ReturnType<typeof createMockStripeCustomerRepository>;
  let moduleRef: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    companyRepository = createMockCompanyRepository();
    logger = createMockLoggingService();
    stripeCustomerAdminService = createMockStripeCustomerAdminService();
    stripeSubscriptionAdminService = createMockStripeSubscriptionAdminService();
    stripePriceRepository = createMockStripePriceRepository();
    stripeCustomerRepository = createMockStripeCustomerRepository();

    // Mock ModuleRef to return our mocked services
    moduleRef = {
      get: vi.fn((token) => {
        if (token === StripeCustomerAdminService) return stripeCustomerAdminService;
        if (token === StripeSubscriptionAdminService) return stripeSubscriptionAdminService;
        if (token === StripePriceRepository) return stripePriceRepository;
        if (token === StripeCustomerRepository) return stripeCustomerRepository;
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrialService,
        { provide: ModuleRef, useValue: moduleRef },
        { provide: CompanyRepository, useValue: companyRepository },
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
      companyRepository.updateTokens.mockResolvedValue(undefined);
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
      expect(companyRepository.updateTokens).toHaveBeenCalledWith({
        companyId: trialParams.companyId,
        monthlyCredits: MOCK_TRIAL_PRICE.token,
        availableMonthlyCredits: MOCK_TRIAL_PRICE.token,
      });
      expect(companyRepository.markSubscriptionStatus).toHaveBeenCalledWith({
        companyId: trialParams.companyId,
        isActiveSubscription: true,
      });
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("Trial started"));
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

    it("should skip trial creation when Stripe customer already exists", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_CUSTOMER_ENTITY);

      await service.startTrial(trialParams);

      expect(companyRepository.findByCompanyId).toHaveBeenCalled();
      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: trialParams.companyId });
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("already has Stripe customer"));
      expect(stripePriceRepository.findTrialPrice).not.toHaveBeenCalled();
      expect(stripeCustomerAdminService.createCustomer).not.toHaveBeenCalled();
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

    it("should skip token allocation when trial price has no tokens", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE_NO_TOKENS);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial(trialParams);

      expect(companyRepository.updateTokens).not.toHaveBeenCalled();
      expect(companyRepository.markSubscriptionStatus).toHaveBeenCalledWith({
        companyId: trialParams.companyId,
        isActiveSubscription: true,
      });
    });

    it("should skip token allocation when trial price has zero tokens", async () => {
      const priceWithZeroTokens = { ...MOCK_TRIAL_PRICE, token: 0 };
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(priceWithZeroTokens);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial(trialParams);

      expect(companyRepository.updateTokens).not.toHaveBeenCalled();
    });

    it("should continue with trial when company has no subscription", async () => {
      const companyWithNullSubscription = { ...MOCK_COMPANY, isActiveSubscription: null };
      companyRepository.findByCompanyId.mockResolvedValue(companyWithNullSubscription);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyRepository.updateTokens.mockResolvedValue(undefined);
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
      companyRepository.updateTokens.mockResolvedValue(undefined);
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial(trialParams);

      expect(stripeCustomerAdminService.createCustomer).toHaveBeenCalled();
      expect(stripeSubscriptionAdminService.createSubscription).toHaveBeenCalled();
    });
  });

  describe("Lazy Loading via ModuleRef", () => {
    it("should lazily load StripeCustomerAdminService via ModuleRef", async () => {
      companyRepository.findByCompanyId.mockResolvedValue(MOCK_COMPANY);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);
      stripePriceRepository.findTrialPrice.mockResolvedValue(MOCK_TRIAL_PRICE);
      stripeCustomerAdminService.createCustomer.mockResolvedValue({ data: { id: MOCK_CUSTOMER_ENTITY.id } });
      stripeSubscriptionAdminService.createSubscription.mockResolvedValue({ data: { id: "sub_123" } });
      companyRepository.updateTokens.mockResolvedValue(undefined);
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
      companyRepository.updateTokens.mockResolvedValue(undefined);
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
      companyRepository.updateTokens.mockResolvedValue(undefined);
      companyRepository.markSubscriptionStatus.mockResolvedValue(undefined);

      await service.startTrial({
        companyId: TEST_IDS.companyId,
        userId: MOCK_USER_ID,
      });

      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("5000 tokens"));
    });
  });
});
