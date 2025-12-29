import { Test, TestingModule } from "@nestjs/testing";
import { StripeSubscriptionService } from "./stripe.subscription.service";
import { StripeService } from "./stripe.service";
import { StripeError } from "../errors/stripe.errors";
import { createMockStripeClient, MockStripeClient } from "../__tests__/mocks/stripe.mock";
import {
  MOCK_SUBSCRIPTION,
  MOCK_INVOICE,
  TEST_IDS,
  STRIPE_CARD_ERROR,
  STRIPE_INVALID_REQUEST_ERROR,
  STRIPE_API_ERROR,
  STRIPE_RATE_LIMIT_ERROR,
} from "../__tests__/fixtures/stripe.fixtures";
import Stripe from "stripe";

describe("StripeSubscriptionService", () => {
  let service: StripeSubscriptionService;
  let stripeService: jest.Mocked<StripeService>;
  let mockStripe: MockStripeClient;

  beforeEach(async () => {
    mockStripe = createMockStripeClient();

    const mockStripeService = {
      getClient: jest.fn().mockReturnValue(mockStripe),
      isConfigured: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeSubscriptionService,
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    service = module.get<StripeSubscriptionService>(StripeSubscriptionService);
    stripeService = module.get(StripeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createSubscription", () => {
    const validParams = {
      stripeCustomerId: TEST_IDS.customerId,
      priceId: TEST_IDS.priceId,
    };

    it("should create subscription with minimal params", async () => {
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      const result = await service.createSubscription(validParams);

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith({
        customer: validParams.stripeCustomerId,
        items: [{ price: validParams.priceId }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
        metadata: undefined,
      });
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should create subscription with payment method", async () => {
      const paramsWithPaymentMethod = {
        ...validParams,
        paymentMethodId: TEST_IDS.paymentMethodId,
      };
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.createSubscription(paramsWithPaymentMethod);

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          default_payment_method: TEST_IDS.paymentMethodId,
        }),
      );
    });

    it("should create subscription with trial period", async () => {
      const paramsWithTrial = {
        ...validParams,
        trialPeriodDays: 14,
      };
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.createSubscription(paramsWithTrial);

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          trial_period_days: 14,
        }),
      );
    });

    it("should create subscription with metadata", async () => {
      const paramsWithMetadata = {
        ...validParams,
        metadata: { companyId: TEST_IDS.companyId, plan: "premium" },
      };
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.createSubscription(paramsWithMetadata);

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { companyId: TEST_IDS.companyId, plan: "premium" },
        }),
      );
    });

    it("should create subscription with all optional params", async () => {
      const fullParams = {
        stripeCustomerId: TEST_IDS.customerId,
        priceId: TEST_IDS.priceId,
        paymentMethodId: TEST_IDS.paymentMethodId,
        trialPeriodDays: 30,
        metadata: { companyId: TEST_IDS.companyId, tier: "enterprise" },
      };
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      const result = await service.createSubscription(fullParams);

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith({
        customer: fullParams.stripeCustomerId,
        items: [{ price: fullParams.priceId }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
        default_payment_method: fullParams.paymentMethodId,
        trial_period_days: 30,
        metadata: fullParams.metadata,
      });
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should handle Stripe card errors", async () => {
      mockStripe.subscriptions.create.mockRejectedValue(STRIPE_CARD_ERROR);

      await expect(service.createSubscription(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe invalid request errors", async () => {
      mockStripe.subscriptions.create.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.createSubscription(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.subscriptions.create.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.createSubscription(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe rate limit errors", async () => {
      mockStripe.subscriptions.create.mockRejectedValue(STRIPE_RATE_LIMIT_ERROR);

      await expect(service.createSubscription(validParams)).rejects.toThrow(StripeError);
    });
  });

  describe("retrieveSubscription", () => {
    it("should retrieve subscription successfully", async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue(MOCK_SUBSCRIPTION);

      const result = await service.retrieveSubscription(TEST_IDS.subscriptionId);

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        expand: ["latest_invoice", "default_payment_method"],
      });
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should expand latest_invoice and default_payment_method", async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.retrieveSubscription(TEST_IDS.subscriptionId);

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
        TEST_IDS.subscriptionId,
        expect.objectContaining({
          expand: expect.arrayContaining(["latest_invoice", "default_payment_method"]),
        }),
      );
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.subscriptions.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.retrieveSubscription(TEST_IDS.subscriptionId)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe invalid request errors for non-existent subscription", async () => {
      mockStripe.subscriptions.retrieve.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.retrieveSubscription("sub_nonexistent")).rejects.toThrow(StripeError);
    });
  });

  describe("updateSubscription", () => {
    it("should update subscription with new price", async () => {
      const currentSub = {
        ...MOCK_SUBSCRIPTION,
        items: {
          ...MOCK_SUBSCRIPTION.items,
          data: [{ ...MOCK_SUBSCRIPTION.items.data[0], id: "si_current_123" }],
        },
      };
      mockStripe.subscriptions.retrieve.mockResolvedValue(currentSub as Stripe.Subscription);
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        subscriptionId: TEST_IDS.subscriptionId,
        priceId: "price_new_123",
      };

      await service.updateSubscription(params);

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(TEST_IDS.subscriptionId);
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        items: [{ id: "si_current_123", price: "price_new_123" }],
      });
    });

    it("should update subscription with proration behavior", async () => {
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        subscriptionId: TEST_IDS.subscriptionId,
        prorationBehavior: "create_prorations" as Stripe.SubscriptionUpdateParams.ProrationBehavior,
      };

      await service.updateSubscription(params);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        proration_behavior: "create_prorations",
      });
    });

    it("should update subscription with metadata", async () => {
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        subscriptionId: TEST_IDS.subscriptionId,
        metadata: { tier: "premium", updated: "true" },
      };

      await service.updateSubscription(params);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        metadata: { tier: "premium", updated: "true" },
      });
    });

    it("should update subscription with multiple parameters", async () => {
      const currentSub = {
        ...MOCK_SUBSCRIPTION,
        items: {
          ...MOCK_SUBSCRIPTION.items,
          data: [{ ...MOCK_SUBSCRIPTION.items.data[0], id: "si_current_123" }],
        },
      };
      mockStripe.subscriptions.retrieve.mockResolvedValue(currentSub as Stripe.Subscription);
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        subscriptionId: TEST_IDS.subscriptionId,
        priceId: "price_new_123",
        prorationBehavior: "none" as Stripe.SubscriptionUpdateParams.ProrationBehavior,
        metadata: { updated: "true" },
      };

      await service.updateSubscription(params);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        items: [{ id: "si_current_123", price: "price_new_123" }],
        proration_behavior: "none",
        metadata: { updated: "true" },
      });
    });

    it("should handle empty items array when updating price", async () => {
      const subWithoutItems = {
        ...MOCK_SUBSCRIPTION,
        items: { ...MOCK_SUBSCRIPTION.items, data: [] },
      };
      mockStripe.subscriptions.retrieve.mockResolvedValue(subWithoutItems as Stripe.Subscription);
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        subscriptionId: TEST_IDS.subscriptionId,
        priceId: "price_new_123",
      };

      await service.updateSubscription(params);

      // Should not include items when no current item exists
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {});
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.subscriptions.update.mockRejectedValue(STRIPE_API_ERROR);

      const params = {
        subscriptionId: TEST_IDS.subscriptionId,
        metadata: { test: "value" },
      };

      await expect(service.updateSubscription(params)).rejects.toThrow(StripeError);
    });
  });

  describe("cancelSubscription", () => {
    it("should cancel subscription at period end by default", async () => {
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);

      const result = await service.cancelSubscription(TEST_IDS.subscriptionId);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        cancel_at_period_end: true,
      });
      expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should cancel subscription immediately when cancelAtPeriodEnd is false", async () => {
      mockStripe.subscriptions.cancel.mockResolvedValue(MOCK_SUBSCRIPTION);

      const result = await service.cancelSubscription(TEST_IDS.subscriptionId, false);

      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith(TEST_IDS.subscriptionId);
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should cancel subscription at period end when explicitly set to true", async () => {
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.cancelSubscription(TEST_IDS.subscriptionId, true);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        cancel_at_period_end: true,
      });
      expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
    });

    it("should handle Stripe API errors when canceling at period end", async () => {
      mockStripe.subscriptions.update.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.cancelSubscription(TEST_IDS.subscriptionId, true)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors when canceling immediately", async () => {
      mockStripe.subscriptions.cancel.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.cancelSubscription(TEST_IDS.subscriptionId, false)).rejects.toThrow(StripeError);
    });
  });

  describe("pauseSubscription", () => {
    it("should pause subscription without resume date", async () => {
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);

      const result = await service.pauseSubscription(TEST_IDS.subscriptionId);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        pause_collection: {
          behavior: "mark_uncollectible",
        },
      });
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should pause subscription with resume date", async () => {
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);
      const resumeDate = new Date("2025-12-31T23:59:59Z");
      const expectedTimestamp = Math.floor(resumeDate.getTime() / 1000);

      const result = await service.pauseSubscription(TEST_IDS.subscriptionId, resumeDate);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        pause_collection: {
          behavior: "mark_uncollectible",
          resumes_at: expectedTimestamp,
        },
      });
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should convert resume date to Unix timestamp correctly", async () => {
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);
      const resumeDate = new Date("2025-01-15T12:00:00Z");
      const expectedTimestamp = Math.floor(resumeDate.getTime() / 1000);

      await service.pauseSubscription(TEST_IDS.subscriptionId, resumeDate);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        TEST_IDS.subscriptionId,
        expect.objectContaining({
          pause_collection: expect.objectContaining({
            resumes_at: expectedTimestamp,
          }),
        }),
      );
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.subscriptions.update.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.pauseSubscription(TEST_IDS.subscriptionId)).rejects.toThrow(StripeError);
    });
  });

  describe("resumeSubscription", () => {
    it("should resume paused subscription", async () => {
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);

      const result = await service.resumeSubscription(TEST_IDS.subscriptionId);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {
        pause_collection: "" as any,
      });
      expect(result).toEqual(MOCK_SUBSCRIPTION);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.subscriptions.update.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.resumeSubscription(TEST_IDS.subscriptionId)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe invalid request errors for non-paused subscription", async () => {
      mockStripe.subscriptions.update.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.resumeSubscription(TEST_IDS.subscriptionId)).rejects.toThrow(StripeError);
    });
  });

  describe("previewProration", () => {
    it("should preview proration for subscription change", async () => {
      const subscription = {
        ...MOCK_SUBSCRIPTION,
        items: { ...MOCK_SUBSCRIPTION.items, data: [{ ...MOCK_SUBSCRIPTION.items.data[0], id: "si_test_123" }] },
      };
      mockStripe.subscriptions.retrieve.mockResolvedValue(subscription as Stripe.Subscription);
      mockStripe.invoices.createPreview = jest.fn().mockResolvedValue(MOCK_INVOICE);

      const result = await service.previewProration(TEST_IDS.subscriptionId, "price_new_123");

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(TEST_IDS.subscriptionId);
      expect(mockStripe.invoices.createPreview).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        subscription: TEST_IDS.subscriptionId,
        subscription_details: {
          items: [{ id: "si_test_123", price: "price_new_123" }],
          proration_behavior: "create_prorations",
        },
      });
      expect(result).toEqual(MOCK_INVOICE);
    });

    it("should handle subscription with no items", async () => {
      const subWithoutItems = {
        ...MOCK_SUBSCRIPTION,
        items: { ...MOCK_SUBSCRIPTION.items, data: [] },
      };
      mockStripe.subscriptions.retrieve.mockResolvedValue(subWithoutItems as Stripe.Subscription);
      mockStripe.invoices.createPreview = jest.fn().mockResolvedValue(MOCK_INVOICE);

      await service.previewProration(TEST_IDS.subscriptionId, "price_new_123");

      expect(mockStripe.invoices.createPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_details: expect.objectContaining({
            items: [{ id: undefined, price: "price_new_123" }],
          }),
        }),
      );
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.subscriptions.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.previewProration(TEST_IDS.subscriptionId, "price_new_123")).rejects.toThrow(StripeError);
    });

    it("should handle invoice preview errors", async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue(MOCK_SUBSCRIPTION);
      mockStripe.invoices.createPreview = jest.fn().mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.previewProration(TEST_IDS.subscriptionId, "price_new_123")).rejects.toThrow(StripeError);
    });
  });

  describe("listSubscriptions", () => {
    it("should list all subscriptions for customer", async () => {
      const subscriptionsList = {
        object: "list" as const,
        data: [MOCK_SUBSCRIPTION],
        has_more: false,
        url: "/v1/subscriptions",
      };
      mockStripe.subscriptions.list.mockResolvedValue(subscriptionsList);

      const result = await service.listSubscriptions(TEST_IDS.customerId);

      expect(mockStripe.subscriptions.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 100,
      });
      expect(result).toEqual([MOCK_SUBSCRIPTION]);
    });

    it("should list subscriptions with status filter", async () => {
      const subscriptionsList = {
        object: "list" as const,
        data: [MOCK_SUBSCRIPTION],
        has_more: false,
        url: "/v1/subscriptions",
      };
      mockStripe.subscriptions.list.mockResolvedValue(subscriptionsList);

      await service.listSubscriptions(TEST_IDS.customerId, "active");

      expect(mockStripe.subscriptions.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 100,
        status: "active",
      });
    });

    it("should list subscriptions with different status filters", async () => {
      const subscriptionsList = {
        object: "list" as const,
        data: [],
        has_more: false,
        url: "/v1/subscriptions",
      };
      mockStripe.subscriptions.list.mockResolvedValue(subscriptionsList);

      await service.listSubscriptions(TEST_IDS.customerId, "canceled");

      expect(mockStripe.subscriptions.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        limit: 100,
        status: "canceled",
      });
    });

    it("should return empty array when no subscriptions", async () => {
      const subscriptionsList = {
        object: "list" as const,
        data: [],
        has_more: false,
        url: "/v1/subscriptions",
      };
      mockStripe.subscriptions.list.mockResolvedValue(subscriptionsList);

      const result = await service.listSubscriptions(TEST_IDS.customerId);

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("should return multiple subscriptions", async () => {
      const multipleSubscriptions = [
        MOCK_SUBSCRIPTION,
        { ...MOCK_SUBSCRIPTION, id: "sub_second_123" },
        { ...MOCK_SUBSCRIPTION, id: "sub_third_123" },
      ];
      const subscriptionsList = {
        object: "list" as const,
        data: multipleSubscriptions,
        has_more: false,
        url: "/v1/subscriptions",
      };
      mockStripe.subscriptions.list.mockResolvedValue(subscriptionsList);

      const result = await service.listSubscriptions(TEST_IDS.customerId);

      expect(result).toEqual(multipleSubscriptions);
      expect(result.length).toBe(3);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.subscriptions.list.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.listSubscriptions(TEST_IDS.customerId)).rejects.toThrow(StripeError);
    });
  });

  describe("Edge Cases", () => {
    it("should handle subscription with trial period of 0 days", async () => {
      const paramsWithZeroTrial = {
        stripeCustomerId: TEST_IDS.customerId,
        priceId: TEST_IDS.priceId,
        trialPeriodDays: 0,
      };
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.createSubscription(paramsWithZeroTrial);

      // When trialPeriodDays is 0 (falsy), it's not included in the params
      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          trial_period_days: 0,
        }),
      );
    });

    it("should handle subscription update with only subscriptionId", async () => {
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);

      const params = {
        subscriptionId: TEST_IDS.subscriptionId,
      };

      await service.updateSubscription(params);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(TEST_IDS.subscriptionId, {});
    });

    it("should handle empty metadata object", async () => {
      const paramsWithEmptyMetadata = {
        stripeCustomerId: TEST_IDS.customerId,
        priceId: TEST_IDS.priceId,
        metadata: {},
      };
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.createSubscription(paramsWithEmptyMetadata);

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {},
        }),
      );
    });

    it("should handle pause with future resume date", async () => {
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);
      const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days in future

      await service.pauseSubscription(TEST_IDS.subscriptionId, futureDate);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        TEST_IDS.subscriptionId,
        expect.objectContaining({
          pause_collection: expect.objectContaining({
            resumes_at: Math.floor(futureDate.getTime() / 1000),
          }),
        }),
      );
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact customer ID in create", async () => {
      const exactParams = {
        stripeCustomerId: "cus_exact_customer_123",
        priceId: "price_exact_123",
      };
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.createSubscription(exactParams);

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: "cus_exact_customer_123",
        }),
      );
    });

    it("should preserve exact price ID in create", async () => {
      const exactParams = {
        stripeCustomerId: TEST_IDS.customerId,
        priceId: "price_exact_premium_999",
      };
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.createSubscription(exactParams);

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [{ price: "price_exact_premium_999" }],
        }),
      );
    });

    it("should preserve exact metadata values", async () => {
      const exactParams = {
        stripeCustomerId: TEST_IDS.customerId,
        priceId: TEST_IDS.priceId,
        metadata: { companyId: "comp_exact_123", userId: "user_exact_456" },
      };
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.createSubscription(exactParams);

      expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { companyId: "comp_exact_123", userId: "user_exact_456" },
        }),
      );
    });

    it("should preserve exact subscription ID in operations", async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.retrieveSubscription("sub_exact_subscription_123");

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
        "sub_exact_subscription_123",
        expect.any(Object),
      );
    });
  });

  describe("Service Integration", () => {
    it("should use StripeService to get client", async () => {
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.createSubscription({
        stripeCustomerId: TEST_IDS.customerId,
        priceId: TEST_IDS.priceId,
      });

      expect(stripeService.getClient).toHaveBeenCalled();
    });

    it("should call getClient before each operation", async () => {
      mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);
      mockStripe.subscriptions.retrieve.mockResolvedValue(MOCK_SUBSCRIPTION);
      mockStripe.subscriptions.update.mockResolvedValue(MOCK_SUBSCRIPTION);
      mockStripe.subscriptions.cancel.mockResolvedValue(MOCK_SUBSCRIPTION);

      await service.createSubscription({
        stripeCustomerId: TEST_IDS.customerId,
        priceId: TEST_IDS.priceId,
      });
      await service.retrieveSubscription(TEST_IDS.subscriptionId);
      await service.updateSubscription({
        subscriptionId: TEST_IDS.subscriptionId,
        metadata: { updated: "true" },
      });
      await service.cancelSubscription(TEST_IDS.subscriptionId, false);

      expect(stripeService.getClient).toHaveBeenCalledTimes(4);
    });
  });
});
