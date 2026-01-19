import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { FeatureSyncService } from "../feature-sync.service";
import { StripeSubscriptionRepository } from "../../repositories/stripe-subscription.repository";
import { CompanyRepository } from "../../../company/repositories/company.repository";
import { StripePriceRepository } from "../../../stripe-price/repositories/stripe-price.repository";
import { AppLoggingService } from "../../../../core/logging";

describe("FeatureSyncService", () => {
  let service: FeatureSyncService;
  let subscriptionRepository: vi.Mocked<StripeSubscriptionRepository>;
  let companyRepository: vi.Mocked<CompanyRepository>;
  let stripePriceRepository: vi.Mocked<StripePriceRepository>;
  let logger: vi.Mocked<AppLoggingService>;

  // Test data constants
  const MOCK_COMPANY_ID = "660e8400-e29b-41d4-a716-446655440001";
  const MOCK_SUBSCRIPTION_ID = "sub_stripe_123";
  const MOCK_CUSTOMER_INTERNAL_ID = "990e8400-e29b-41d4-a716-446655440001";
  const MOCK_STRIPE_CUSTOMER_ID = "cus_stripe_123";
  const MOCK_PRICE_ID = "ee0e8400-e29b-41d4-a716-446655440001";

  const MOCK_FEATURE_1 = { id: "feat-1", name: "Feature 1" };
  const MOCK_FEATURE_2 = { id: "feat-2", name: "Feature 2" };

  const MOCK_PRICE_WITH_FEATURES = {
    id: MOCK_PRICE_ID,
    stripePriceId: "price_stripe_123",
    priceType: "recurring" as const,
    feature: [MOCK_FEATURE_1, MOCK_FEATURE_2],
    active: true,
    currency: "usd",
    unitAmount: 999,
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeProduct: {} as any,
  };

  const MOCK_PRICE_WITHOUT_FEATURES = {
    ...MOCK_PRICE_WITH_FEATURES,
    feature: [],
  };

  const MOCK_SUBSCRIPTION_RECURRING = {
    id: "sub_internal_123",
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
      stripeCustomerId: MOCK_STRIPE_CUSTOMER_ID,
      email: "test@example.com",
      name: "Test Customer",
      currency: "usd",
      balance: 0,
      delinquent: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      company: {} as any,
    },
    stripePrice: {
      id: MOCK_PRICE_ID,
      priceType: "recurring" as const,
    },
  };

  const MOCK_SUBSCRIPTION_ONE_TIME = {
    ...MOCK_SUBSCRIPTION_RECURRING,
    stripePrice: {
      id: MOCK_PRICE_ID,
      priceType: "one_time" as const,
    },
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
      findActiveByStripeCustomerId: vi.fn(),
    };

    const mockCompanyRepository = {
      findByStripeCustomerId: vi.fn(),
      addFeatures: vi.fn(),
      removeFeatures: vi.fn(),
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
        FeatureSyncService,
        { provide: StripeSubscriptionRepository, useValue: mockSubscriptionRepository },
        { provide: CompanyRepository, useValue: mockCompanyRepository },
        { provide: StripePriceRepository, useValue: mockStripePriceRepository },
        { provide: AppLoggingService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<FeatureSyncService>(FeatureSyncService);
    subscriptionRepository = module.get(StripeSubscriptionRepository);
    companyRepository = module.get(CompanyRepository);
    stripePriceRepository = module.get(StripePriceRepository);
    logger = module.get(AppLoggingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("syncFeaturesOnPayment", () => {
    it("should add features on recurring subscription payment", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_RECURRING as any);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITH_FEATURES as any);
      companyRepository.findByStripeCustomerId.mockResolvedValue(MOCK_COMPANY as any);
      companyRepository.addFeatures.mockResolvedValue(["feat-1", "feat-2"]);

      const result = await service.syncFeaturesOnPayment({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(result.featuresAdded).toEqual(["feat-1", "feat-2"]);
      expect(result.companyId).toBe(MOCK_COMPANY_ID);
      expect(companyRepository.addFeatures).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
        featureIds: ["feat-1", "feat-2"],
      });
    });

    it("should skip feature sync for non-recurring price", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_ONE_TIME as any);

      const result = await service.syncFeaturesOnPayment({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("Not a recurring subscription");
      expect(companyRepository.addFeatures).not.toHaveBeenCalled();
    });

    it("should skip if no features configured on price", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_RECURRING as any);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITHOUT_FEATURES as any);

      const result = await service.syncFeaturesOnPayment({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("No features configured for this price");
      expect(companyRepository.addFeatures).not.toHaveBeenCalled();
    });

    it("should return failure if subscription not found", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(null);

      const result = await service.syncFeaturesOnPayment({
        stripeSubscriptionId: "sub_unknown",
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Subscription not found");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should return failure if company not found", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_RECURRING as any);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITH_FEATURES as any);
      companyRepository.findByStripeCustomerId.mockResolvedValue(null);

      const result = await service.syncFeaturesOnPayment({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Company not found");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("removeFeaturesOnSubscriptionEnd", () => {
    it("should remove features when no other active subscriptions", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_RECURRING as any);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITH_FEATURES as any);
      companyRepository.findByStripeCustomerId.mockResolvedValue(MOCK_COMPANY as any);
      subscriptionRepository.findActiveByStripeCustomerId.mockResolvedValue([]);
      companyRepository.removeFeatures.mockResolvedValue(["feat-1", "feat-2"]);

      const result = await service.removeFeaturesOnSubscriptionEnd({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(result.featuresRemoved).toEqual(["feat-1", "feat-2"]);
      expect(companyRepository.removeFeatures).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
        featureIds: ["feat-1", "feat-2"],
      });
    });

    it("should preserve overlapping features (smart removal)", async () => {
      const canceledPrice = {
        ...MOCK_PRICE_WITH_FEATURES,
        feature: [{ id: "feat-A" }, { id: "feat-B" }],
      };
      const otherActiveSub = {
        stripeSubscriptionId: "sub_active",
        stripePrice: { id: "price-2", priceType: "recurring" as const },
      };
      const otherPrice = {
        id: "price-2",
        feature: [{ id: "feat-A" }], // feat-A is covered
      };

      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_RECURRING as any);
      stripePriceRepository.findById
        .mockResolvedValueOnce(canceledPrice as any) // First call for canceled sub
        .mockResolvedValueOnce(otherPrice as any); // Second call for other active sub
      companyRepository.findByStripeCustomerId.mockResolvedValue(MOCK_COMPANY as any);
      subscriptionRepository.findActiveByStripeCustomerId.mockResolvedValue([otherActiveSub as any]);
      companyRepository.removeFeatures.mockResolvedValue(["feat-B"]);

      const result = await service.removeFeaturesOnSubscriptionEnd({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(companyRepository.removeFeatures).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
        featureIds: ["feat-B"], // Only feat-B removed, feat-A preserved
      });
    });

    it("should skip removal if all features covered by other subscriptions", async () => {
      const canceledPrice = {
        ...MOCK_PRICE_WITH_FEATURES,
        feature: [{ id: "feat-A" }],
      };
      const otherActiveSub = {
        stripeSubscriptionId: "sub_active",
        stripePrice: { id: "price-2", priceType: "recurring" as const },
      };
      const otherPrice = {
        id: "price-2",
        feature: [{ id: "feat-A" }], // Same feature
      };

      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_RECURRING as any);
      stripePriceRepository.findById
        .mockResolvedValueOnce(canceledPrice as any)
        .mockResolvedValueOnce(otherPrice as any);
      companyRepository.findByStripeCustomerId.mockResolvedValue(MOCK_COMPANY as any);
      subscriptionRepository.findActiveByStripeCustomerId.mockResolvedValue([otherActiveSub as any]);

      const result = await service.removeFeaturesOnSubscriptionEnd({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("All features covered by other active subscriptions");
      expect(companyRepository.removeFeatures).not.toHaveBeenCalled();
    });

    it("should skip removal for non-recurring price", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_ONE_TIME as any);

      const result = await service.removeFeaturesOnSubscriptionEnd({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("Not a recurring subscription");
      expect(companyRepository.removeFeatures).not.toHaveBeenCalled();
    });

    it("should return failure if subscription not found", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(null);

      const result = await service.removeFeaturesOnSubscriptionEnd({
        stripeSubscriptionId: "sub_unknown",
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Subscription not found");
    });

    it("should return failure if company not found", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_RECURRING as any);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITH_FEATURES as any);
      companyRepository.findByStripeCustomerId.mockResolvedValue(null);

      const result = await service.removeFeaturesOnSubscriptionEnd({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Company not found");
    });

    it("should exclude the canceled subscription from active list check", async () => {
      // The canceled subscription itself might appear in findActiveByStripeCustomerId
      // if it hasn't been updated yet. It should be excluded.
      const canceledPrice = {
        ...MOCK_PRICE_WITH_FEATURES,
        feature: [{ id: "feat-A" }],
      };
      const theSameSubscription = {
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID, // Same as the one being canceled
        stripePrice: { id: MOCK_PRICE_ID, priceType: "recurring" as const },
      };

      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_RECURRING as any);
      stripePriceRepository.findById.mockResolvedValue(canceledPrice as any);
      companyRepository.findByStripeCustomerId.mockResolvedValue(MOCK_COMPANY as any);
      // The canceled subscription is in the active list (edge case)
      subscriptionRepository.findActiveByStripeCustomerId.mockResolvedValue([theSameSubscription as any]);
      companyRepository.removeFeatures.mockResolvedValue(["feat-A"]);

      const result = await service.removeFeaturesOnSubscriptionEnd({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      // feat-A should still be removed because the same subscription is excluded
      expect(companyRepository.removeFeatures).toHaveBeenCalledWith({
        companyId: MOCK_COMPANY_ID,
        featureIds: ["feat-A"],
      });
    });

    it("should skip if no features configured on price", async () => {
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_SUBSCRIPTION_RECURRING as any);
      stripePriceRepository.findById.mockResolvedValue(MOCK_PRICE_WITHOUT_FEATURES as any);

      const result = await service.removeFeaturesOnSubscriptionEnd({
        stripeSubscriptionId: MOCK_SUBSCRIPTION_ID,
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("No features configured for this price");
      expect(companyRepository.removeFeatures).not.toHaveBeenCalled();
    });
  });
});
