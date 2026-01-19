import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { TokenAllocationService } from "../token-allocation.service";
import { StripeSubscriptionRepository } from "../../repositories/stripe-subscription.repository";
import { CompanyRepository } from "../../../company/repositories/company.repository";
import { StripePriceRepository } from "../../../stripe-price/repositories/stripe-price.repository";
import { AppLoggingService } from "../../../../core/logging";

describe("TokenAllocationService", () => {
  let service: TokenAllocationService;
  let subscriptionRepository: vi.Mocked<StripeSubscriptionRepository>;
  let companyRepository: vi.Mocked<CompanyRepository>;
  let stripePriceRepository: vi.Mocked<StripePriceRepository>;
  let logger: vi.Mocked<AppLoggingService>;

  // Test data constants
  const MOCK_COMPANY_ID = "660e8400-e29b-41d4-a716-446655440001";
  const MOCK_SUBSCRIPTION_ID = "sub_stripe_123";
  const MOCK_CUSTOMER_INTERNAL_ID = "990e8400-e29b-41d4-a716-446655440001";
  const MOCK_PRICE_ID = "ee0e8400-e29b-41d4-a716-446655440001";
  const MOCK_TOKENS = 10000;

  const MOCK_PRICE_WITH_TOKENS = {
    id: MOCK_PRICE_ID,
    stripePriceId: "price_stripe_123",
    token: MOCK_TOKENS,
    active: true,
    currency: "usd",
    unitAmount: 999,
    priceType: "recurring" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeProduct: {} as any,
  };

  const MOCK_PRICE_WITHOUT_TOKENS = {
    ...MOCK_PRICE_WITH_TOKENS,
    token: undefined,
  };

  const MOCK_SUBSCRIPTION = {
    id: "aa0e8400-e29b-41d4-a716-446655440001",
    stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
    status: "active" as const,
    currentPeriodStart: new Date("2025-01-01T00:00:00Z"),
    currentPeriodEnd: new Date("2025-02-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    quantity: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeCustomer: {
      id: MOCK_CUSTOMER_INTERNAL_ID,
      stripeCustomerId: "cus_stripe_123",
      email: "test@example.com",
      name: "Test Customer",
      currency: "usd",
      balance: 0,
      delinquent: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      company: {} as any,
    },
    stripePrice: MOCK_PRICE_WITH_TOKENS,
  };

  const MOCK_COMPANY = {
    id: MOCK_COMPANY_ID,
    name: "Test Company",
    monthlyTokens: 5000,
    availableMonthlyTokens: 2500,
    availableExtraTokens: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockSubscriptionRepository = {
      findByStripeSubscriptionId: vi.fn(),
    };

    const mockCompanyRepository = {
      findByStripeCustomerId: vi.fn(),
      updateTokens: vi.fn(),
      markSubscriptionStatus: vi.fn(),
    };

    const mockStripePriceRepository = {
      findById: vi.fn(),
    };

    const mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenAllocationService,
        { provide: StripeSubscriptionRepository, useValue: mockSubscriptionRepository },
        { provide: CompanyRepository, useValue: mockCompanyRepository },
        { provide: StripePriceRepository, useValue: mockStripePriceRepository },
        { provide: AppLoggingService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<TokenAllocationService>(TokenAllocationService);
    subscriptionRepository = module.get(StripeSubscriptionRepository);
    companyRepository = module.get(CompanyRepository);
    stripePriceRepository = module.get(StripePriceRepository);
    logger = module.get(AppLoggingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("allocateTokensOnPayment", () => {
    it("should allocate full tokens on successful payment", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION);
      companyRepository.findByStripeCustomerId.mockResolvedValue(MOCK_COMPANY);
      companyRepository.updateTokens.mockResolvedValue(undefined);

      const result = await service.allocateTokensOnPayment({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(result.tokensAllocated).toBe(MOCK_TOKENS);
      expect(result.previousTokens).toBe(2500);
      expect(result.companyId).toBe(MOCK_COMPANY_ID);

      expect(companyRepository.updateTokens).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
        monthlyTokens: MOCK_TOKENS,
        availableMonthlyTokens: MOCK_TOKENS,
      });
    });

    it("should skip allocation when price has no tokens", async () => {
      const subscriptionWithoutTokens = {
        ...MOCK_SUBSCRIPTION,
        stripePrice: MOCK_PRICE_WITHOUT_TOKENS,
      };
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(subscriptionWithoutTokens);

      const result = await service.allocateTokensOnPayment({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("No tokens configured for this plan");
      expect(companyRepository.updateTokens).not.toHaveBeenCalled();
    });

    it("should return failure when subscription not found", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(null);

      const result = await service.allocateTokensOnPayment({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Subscription not found");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should return failure when company not found", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION);
      companyRepository.findByStripeCustomerId.mockResolvedValue(null);

      const result = await service.allocateTokensOnPayment({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Company not found");
      expect(logger.error).toHaveBeenCalled();
    });

    it("should handle BigInt conversion for previous tokens", async () => {
      const companyWithBigInt = {
        ...MOCK_COMPANY,
        availableMonthlyTokens: BigInt(5000),
      };
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION);
      companyRepository.findByStripeCustomerId.mockResolvedValue(companyWithBigInt);
      companyRepository.updateTokens.mockResolvedValue(undefined);

      const result = await service.allocateTokensOnPayment({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(result.previousTokens).toBe(5000);
    });
  });

  describe("allocateProratedTokensOnPlanChange", () => {
    it("should calculate prorated tokens correctly for mid-cycle change", async () => {
      // 30 day cycle, 15 days remaining = 50% of tokens
      const midCycleSubscription = {
        ...MOCK_SUBSCRIPTION,
        currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
        currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
      };
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(midCycleSubscription);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITH_TOKENS);
      companyRepository.findByStripeCustomerId.mockResolvedValue(MOCK_COMPANY);
      companyRepository.updateTokens.mockResolvedValue(undefined);

      const result = await service.allocateProratedTokensOnPlanChange({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
        newPriceId: MOCK_PRICE_ID,
      });

      expect(result.success).toBe(true);
      // ~50% of 10000 = 5000 (allow some variance due to timing)
      expect(result.tokensAllocated).toBeGreaterThanOrEqual(4900);
      expect(result.tokensAllocated).toBeLessThanOrEqual(5100);
    });

    it("should return 0 tokens when at end of cycle", async () => {
      // End of cycle - period end is in the past
      const endOfCycleSubscription = {
        ...MOCK_SUBSCRIPTION,
        currentPeriodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      };
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(endOfCycleSubscription);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITH_TOKENS);
      companyRepository.findByStripeCustomerId.mockResolvedValue(MOCK_COMPANY);
      companyRepository.updateTokens.mockResolvedValue(undefined);

      const result = await service.allocateProratedTokensOnPlanChange({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
        newPriceId: MOCK_PRICE_ID,
      });

      expect(result.success).toBe(true);
      expect(result.tokensAllocated).toBe(0);
    });

    it("should return full tokens when at start of cycle", async () => {
      // Start of cycle - period just started
      const startOfCycleSubscription = {
        ...MOCK_SUBSCRIPTION,
        currentPeriodStart: new Date(Date.now() - 1000), // Just started
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      };
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(startOfCycleSubscription);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITH_TOKENS);
      companyRepository.findByStripeCustomerId.mockResolvedValue(MOCK_COMPANY);
      companyRepository.updateTokens.mockResolvedValue(undefined);

      const result = await service.allocateProratedTokensOnPlanChange({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
        newPriceId: MOCK_PRICE_ID,
      });

      expect(result.success).toBe(true);
      // Should be close to full allocation
      expect(result.tokensAllocated).toBeGreaterThanOrEqual(9900);
    });

    it("should skip allocation when new price has no tokens", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITHOUT_TOKENS);

      const result = await service.allocateProratedTokensOnPlanChange({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
        newPriceId: MOCK_PRICE_ID,
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("No tokens configured for new plan");
      expect(companyRepository.updateTokens).not.toHaveBeenCalled();
    });

    it("should return failure when subscription not found", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(null);

      const result = await service.allocateProratedTokensOnPlanChange({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
        newPriceId: MOCK_PRICE_ID,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Subscription not found");
    });

    it("should return failure when company not found", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITH_TOKENS);
      companyRepository.findByStripeCustomerId.mockResolvedValue(null);

      const result = await service.allocateProratedTokensOnPlanChange({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
        newPriceId: MOCK_PRICE_ID,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Company not found");
    });

    it("should set monthlyTokens to new plan value", async () => {
      const midCycleSubscription = {
        ...MOCK_SUBSCRIPTION,
        currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      };
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(midCycleSubscription);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITH_TOKENS);
      companyRepository.findByStripeCustomerId.mockResolvedValue(MOCK_COMPANY);
      companyRepository.updateTokens.mockResolvedValue(undefined);

      await service.allocateProratedTokensOnPlanChange({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
        newPriceId: MOCK_PRICE_ID,
      });

      expect(companyRepository.updateTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          monthlyTokens: MOCK_TOKENS, // Full plan value
        }),
      );
    });
  });
});
