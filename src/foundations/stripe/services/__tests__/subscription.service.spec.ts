// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide the imports that SubscriptionService needs
jest.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = jest.requireActual("@carlonicora/nestjs-neo4jsonapi");

  return {
    ...actual,
    // Override companyMeta that billing-customer.model needs
    companyMeta: {
      type: "companies",
      endpoint: "companies",
      nodeName: "company",
      labelName: "Company",
    },
    // Mock StripeSubscriptionService to avoid dependency resolution issues
    StripeSubscriptionService: jest.fn().mockImplementation(() => ({
      createSubscription: jest.fn(),
      retrieveSubscription: jest.fn(),
      cancelSubscription: jest.fn(),
      pauseSubscription: jest.fn(),
      resumeSubscription: jest.fn(),
      updateSubscription: jest.fn(),
      previewProration: jest.fn(),
    })),
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import Stripe from "stripe";
import { SubscriptionService } from "../subscription.service";
import { SubscriptionRepository } from "../../repositories/subscription.repository";
import { BillingCustomerRepository } from "../../repositories/billing-customer.repository";
import { StripePriceRepository } from "../../repositories/stripe-price.repository";
import { StripeSubscriptionService, JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";
import { Subscription, SubscriptionStatus } from "../../entities/subscription.entity";
import { BillingCustomer } from "../../entities/billing-customer.entity";
import { StripePrice } from "../../entities/stripe-price.entity";
import {
  MOCK_SUBSCRIPTION,
  MOCK_PRICE_RECURRING,
  MOCK_INVOICE,
  TEST_IDS,
} from "../../__tests__/fixtures/stripe.fixtures";

describe("SubscriptionService", () => {
  let service: SubscriptionService;
  let subscriptionRepository: jest.Mocked<SubscriptionRepository>;
  let billingCustomerRepository: jest.Mocked<BillingCustomerRepository>;
  let stripePriceRepository: jest.Mocked<StripePriceRepository>;
  let stripeSubscriptionService: jest.Mocked<StripeSubscriptionService>;
  let jsonApiService: jest.Mocked<JsonApiService>;

  // Test data constants
  const MOCK_BILLING_CUSTOMER: BillingCustomer = {
    id: "billing_customer_123",
    stripeCustomerId: TEST_IDS.customerId,
    email: "test@example.com",
    name: "Test Customer",
    currency: "usd",
    balance: 0,
    delinquent: false,
    defaultPaymentMethodId: TEST_IDS.paymentMethodId,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    company: {} as any,
  };

  const MOCK_STRIPE_PRICE: StripePrice = {
    id: "price_db_123",
    stripePriceId: TEST_IDS.priceId,
    active: true,
    currency: "usd",
    unitAmount: 999,
    type: "recurring",
    recurringInterval: "month",
    recurringIntervalCount: 1,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    product: {} as any,
  };

  const MOCK_DB_SUBSCRIPTION: Subscription = {
    id: "subscription_db_123",
    stripeSubscriptionId: TEST_IDS.subscriptionId,
    stripeSubscriptionItemId: "si_test_123",
    status: "active",
    currentPeriodStart: new Date("2025-01-01T00:00:00Z"),
    currentPeriodEnd: new Date("2025-02-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    quantity: 1,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    billingCustomer: MOCK_BILLING_CUSTOMER,
    price: MOCK_STRIPE_PRICE,
  };

  const MOCK_JSON_API_RESPONSE = {
    data: {
      type: "subscriptions",
      id: MOCK_DB_SUBSCRIPTION.id,
      attributes: {
        status: MOCK_DB_SUBSCRIPTION.status,
        currentPeriodStart: MOCK_DB_SUBSCRIPTION.currentPeriodStart,
        currentPeriodEnd: MOCK_DB_SUBSCRIPTION.currentPeriodEnd,
        cancelAtPeriodEnd: MOCK_DB_SUBSCRIPTION.cancelAtPeriodEnd,
        quantity: MOCK_DB_SUBSCRIPTION.quantity,
      },
    },
  };

  const MOCK_JSON_API_LIST_RESPONSE = {
    data: [MOCK_JSON_API_RESPONSE.data],
    meta: {
      page: {
        current: 1,
        total: 1,
      },
    },
  };

  beforeEach(async () => {
    const mockSubscriptionRepository = {
      findById: jest.fn(),
      findByBillingCustomerId: jest.fn(),
      findByStripeSubscriptionId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updatePrice: jest.fn(),
      updateByStripeSubscriptionId: jest.fn(),
    };

    const mockBillingCustomerRepository = {
      findByCompanyId: jest.fn(),
      findById: jest.fn(),
    };

    const mockStripePriceRepository = {
      findById: jest.fn(),
    };

    const mockStripeSubscriptionService = {
      createSubscription: jest.fn(),
      retrieveSubscription: jest.fn(),
      cancelSubscription: jest.fn(),
      pauseSubscription: jest.fn(),
      resumeSubscription: jest.fn(),
      updateSubscription: jest.fn(),
      previewProration: jest.fn(),
    };

    const mockJsonApiService = {
      buildSingle: jest.fn(),
      buildList: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        {
          provide: SubscriptionRepository,
          useValue: mockSubscriptionRepository,
        },
        {
          provide: BillingCustomerRepository,
          useValue: mockBillingCustomerRepository,
        },
        {
          provide: StripePriceRepository,
          useValue: mockStripePriceRepository,
        },
        {
          provide: StripeSubscriptionService,
          useValue: mockStripeSubscriptionService,
        },
        {
          provide: JsonApiService,
          useValue: mockJsonApiService,
        },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    subscriptionRepository = module.get(SubscriptionRepository);
    billingCustomerRepository = module.get(BillingCustomerRepository);
    stripePriceRepository = module.get(StripePriceRepository);
    stripeSubscriptionService = module.get(StripeSubscriptionService);
    jsonApiService = module.get(JsonApiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("listSubscriptions", () => {
    const validParams = {
      companyId: TEST_IDS.companyId,
      query: { page: { number: 1, size: 10 } },
    };

    it("should return paginated subscriptions list", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      subscriptionRepository.findByBillingCustomerId.mockResolvedValue([MOCK_DB_SUBSCRIPTION]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE);

      const result = await service.listSubscriptions(validParams);

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validParams.companyId,
      });
      expect(subscriptionRepository.findByBillingCustomerId).toHaveBeenCalledWith({
        billingCustomerId: MOCK_BILLING_CUSTOMER.id,
        status: undefined,
      });
      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        expect.any(Object),
        [MOCK_DB_SUBSCRIPTION],
        expect.any(Object),
      );
      expect(result).toEqual(MOCK_JSON_API_LIST_RESPONSE);
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.listSubscriptions(validParams)).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(subscriptionRepository.findByBillingCustomerId).not.toHaveBeenCalled();
      expect(jsonApiService.buildList).not.toHaveBeenCalled();
    });

    it("should filter by status when provided", async () => {
      const paramsWithStatus = { ...validParams, status: "active" as SubscriptionStatus };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      subscriptionRepository.findByBillingCustomerId.mockResolvedValue([MOCK_DB_SUBSCRIPTION]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE);

      await service.listSubscriptions(paramsWithStatus);

      expect(subscriptionRepository.findByBillingCustomerId).toHaveBeenCalledWith({
        billingCustomerId: MOCK_BILLING_CUSTOMER.id,
        status: "active",
      });
    });

    it("should use JsonApiPaginator with query params", async () => {
      const customQuery = { page: { number: 2, size: 20 } };
      const paramsWithCustomQuery = { ...validParams, query: customQuery };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      subscriptionRepository.findByBillingCustomerId.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [], meta: {} });

      await service.listSubscriptions(paramsWithCustomQuery);

      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        expect.any(Object),
        [],
        expect.any(Object), // JsonApiPaginator instance
      );
    });

    it("should return empty list when no subscriptions exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      subscriptionRepository.findByBillingCustomerId.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [], meta: {} });

      const result = await service.listSubscriptions(validParams);

      expect(result).toEqual({ data: [], meta: {} });
    });
  });

  describe("getSubscription", () => {
    const validParams = {
      id: MOCK_DB_SUBSCRIPTION.id,
      companyId: TEST_IDS.companyId,
    };

    it("should return subscription when found and ownership verified", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.getSubscription(validParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validParams.companyId,
      });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_DB_SUBSCRIPTION);
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.getSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(billingCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when customer does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentCustomer = { ...MOCK_BILLING_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.getSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN with correct status code", async () => {
      const differentCustomer = { ...MOCK_BILLING_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      try {
        await service.getSubscription(validParams);
        fail("Should have thrown HttpException");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect((error as HttpException).message).toBe("Subscription does not belong to this company");
      }
    });
  });

  describe("createSubscription", () => {
    const validParams = {
      companyId: TEST_IDS.companyId,
      priceId: MOCK_STRIPE_PRICE.id,
    };

    const mockStripeSubscriptionWithItem: Stripe.Subscription = {
      ...MOCK_SUBSCRIPTION,
      items: {
        ...MOCK_SUBSCRIPTION.items,
        data: [
          {
            ...MOCK_SUBSCRIPTION.items.data[0],
            current_period_start: 1704067200, // Unix timestamp: 2024-01-01 00:00:00
            current_period_end: 1706745600, // Unix timestamp: 2024-02-01 00:00:00
          },
        ],
      },
    };

    it("should create subscription successfully with minimal params", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.create.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.createSubscription(validParams);

      expect(billingCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validParams.companyId,
      });
      expect(stripePriceRepository.findById).toHaveBeenCalledWith({ id: validParams.priceId });
      expect(stripeSubscriptionService.createSubscription).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_BILLING_CUSTOMER.stripeCustomerId,
        priceId: MOCK_STRIPE_PRICE.stripePriceId,
        paymentMethodId: undefined,
        trialPeriodDays: undefined,
        metadata: {
          companyId: validParams.companyId,
          priceId: validParams.priceId,
        },
      });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.createSubscription(validParams)).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(stripePriceRepository.findById).not.toHaveBeenCalled();
      expect(stripeSubscriptionService.createSubscription).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when price does not exist", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(null);

      await expect(service.createSubscription(validParams)).rejects.toThrow(
        new HttpException("Price not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeSubscriptionService.createSubscription).not.toHaveBeenCalled();
    });

    it("should convert Unix timestamps to Date objects (multiply by 1000)", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.create.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(subscriptionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPeriodStart: new Date(1704067200 * 1000),
          currentPeriodEnd: new Date(1706745600 * 1000),
        }),
      );
    });

    it("should handle optional trial dates with Unix timestamp conversion", async () => {
      const subscriptionWithTrial: Stripe.Subscription = {
        ...mockStripeSubscriptionWithItem,
        trial_start: 1704067200, // Unix timestamp
        trial_end: 1706745600, // Unix timestamp
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockResolvedValue(subscriptionWithTrial);
      subscriptionRepository.create.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription({ ...validParams, trialPeriodDays: 30 });

      expect(subscriptionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          trialStart: new Date(1704067200 * 1000),
          trialEnd: new Date(1706745600 * 1000),
        }),
      );
    });

    it("should pass undefined for trial dates when not present", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.create.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(subscriptionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          trialStart: undefined,
          trialEnd: undefined,
        }),
      );
    });

    it("should default quantity to 1 when not provided", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.create.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(subscriptionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 1,
        }),
      );
    });

    it("should use provided quantity when specified", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.create.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription({ ...validParams, quantity: 5 });

      expect(subscriptionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 5,
        }),
      );
    });

    it("should create subscription in Stripe before database", async () => {
      const callOrder: string[] = [];
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockImplementation(async () => {
        callOrder.push("stripe");
        return mockStripeSubscriptionWithItem;
      });
      subscriptionRepository.create.mockImplementation(async () => {
        callOrder.push("database");
        return MOCK_DB_SUBSCRIPTION;
      });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(callOrder).toEqual(["stripe", "database"]);
    });

    it("should include metadata with companyId and priceId", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.create.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(stripeSubscriptionService.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            companyId: validParams.companyId,
            priceId: validParams.priceId,
          },
        }),
      );
    });

    it("should pass optional paymentMethodId to Stripe", async () => {
      const paramsWithPaymentMethod = { ...validParams, paymentMethodId: TEST_IDS.paymentMethodId };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.create.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(paramsWithPaymentMethod);

      expect(stripeSubscriptionService.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethodId: TEST_IDS.paymentMethodId,
        }),
      );
    });

    it("should return JSON:API formatted response", async () => {
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.create.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.createSubscription(validParams);

      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_DB_SUBSCRIPTION);
    });
  });

  describe("cancelSubscription", () => {
    const validParams = {
      id: MOCK_DB_SUBSCRIPTION.id,
      companyId: TEST_IDS.companyId,
    };

    const mockCanceledSubscription: Stripe.Subscription = {
      ...MOCK_SUBSCRIPTION,
      status: "canceled",
      cancel_at_period_end: false,
      canceled_at: 1704067200, // Unix timestamp
    };

    it("should cancel subscription at period end by default", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.cancelSubscription.mockResolvedValue(mockCanceledSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "canceled" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.cancelSubscription(validParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(stripeSubscriptionService.cancelSubscription).toHaveBeenCalledWith(
        MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
        true, // !cancelImmediately (cancelAtPeriodEnd = true)
      );
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.cancelSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(billingCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(stripeSubscriptionService.cancelSubscription).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when customer does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.cancelSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripeSubscriptionService.cancelSubscription).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentCustomer = { ...MOCK_BILLING_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.cancelSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripeSubscriptionService.cancelSubscription).not.toHaveBeenCalled();
    });

    it("should cancel immediately when cancelImmediately is true", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.cancelSubscription.mockResolvedValue(mockCanceledSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "canceled" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.cancelSubscription({ ...validParams, cancelImmediately: true });

      expect(stripeSubscriptionService.cancelSubscription).toHaveBeenCalledWith(
        MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
        false, // !cancelImmediately (cancelAtPeriodEnd = false)
      );
    });

    it("should convert Unix timestamp for canceledAt (multiply by 1000)", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.cancelSubscription.mockResolvedValue(mockCanceledSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "canceled" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.cancelSubscription(validParams);

      expect(subscriptionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          canceledAt: new Date(1704067200 * 1000),
        }),
      );
    });

    it("should set canceledAt to undefined when not present in Stripe response", async () => {
      const subscriptionWithoutCanceledAt: Stripe.Subscription = {
        ...MOCK_SUBSCRIPTION,
        canceled_at: null,
      };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.cancelSubscription.mockResolvedValue(subscriptionWithoutCanceledAt);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.cancelSubscription(validParams);

      expect(subscriptionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          canceledAt: undefined,
        }),
      );
    });

    it("should update database with Stripe status and cancel_at_period_end", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.cancelSubscription.mockResolvedValue(mockCanceledSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "canceled" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.cancelSubscription(validParams);

      expect(subscriptionRepository.update).toHaveBeenCalledWith({
        id: validParams.id,
        status: mockCanceledSubscription.status,
        cancelAtPeriodEnd: mockCanceledSubscription.cancel_at_period_end,
        canceledAt: new Date(mockCanceledSubscription.canceled_at! * 1000),
      });
    });
  });

  describe("pauseSubscription", () => {
    const validParams = {
      id: MOCK_DB_SUBSCRIPTION.id,
      companyId: TEST_IDS.companyId,
    };

    const mockPausedSubscription: Stripe.Subscription = {
      ...MOCK_SUBSCRIPTION,
      status: "paused",
    };

    it("should pause subscription successfully", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.pauseSubscription.mockResolvedValue(mockPausedSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "paused" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.pauseSubscription(validParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(stripeSubscriptionService.pauseSubscription).toHaveBeenCalledWith(
        MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
        undefined,
      );
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.pauseSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeSubscriptionService.pauseSubscription).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentCustomer = { ...MOCK_BILLING_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.pauseSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripeSubscriptionService.pauseSubscription).not.toHaveBeenCalled();
    });

    it("should set pausedAt to current date", async () => {
      const beforePause = new Date();
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.pauseSubscription.mockResolvedValue(mockPausedSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "paused" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.pauseSubscription(validParams);
      const afterPause = new Date();

      const updateCall = subscriptionRepository.update.mock.calls[0][0];
      expect(updateCall.pausedAt).toBeInstanceOf(Date);
      expect(updateCall.pausedAt!.getTime()).toBeGreaterThanOrEqual(beforePause.getTime());
      expect(updateCall.pausedAt!.getTime()).toBeLessThanOrEqual(afterPause.getTime());
    });

    it("should pass optional resumeAt to Stripe", async () => {
      const resumeDate = new Date("2025-02-01T00:00:00Z");
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.pauseSubscription.mockResolvedValue(mockPausedSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "paused" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.pauseSubscription({ ...validParams, resumeAt: resumeDate });

      expect(stripeSubscriptionService.pauseSubscription).toHaveBeenCalledWith(
        MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
        resumeDate,
      );
    });

    it("should update status from Stripe response", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.pauseSubscription.mockResolvedValue(mockPausedSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "paused" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.pauseSubscription(validParams);

      expect(subscriptionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "paused",
        }),
      );
    });
  });

  describe("resumeSubscription", () => {
    const validParams = {
      id: MOCK_DB_SUBSCRIPTION.id,
      companyId: TEST_IDS.companyId,
    };

    const mockResumedSubscription: Stripe.Subscription = {
      ...MOCK_SUBSCRIPTION,
      status: "active",
    };

    it("should resume subscription successfully", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.resumeSubscription.mockResolvedValue(mockResumedSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "active" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.resumeSubscription(validParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(stripeSubscriptionService.resumeSubscription).toHaveBeenCalledWith(
        MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
      );
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.resumeSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeSubscriptionService.resumeSubscription).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentCustomer = { ...MOCK_BILLING_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.resumeSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripeSubscriptionService.resumeSubscription).not.toHaveBeenCalled();
    });

    it("should clear pausedAt by setting to null", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.resumeSubscription.mockResolvedValue(mockResumedSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "active" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.resumeSubscription(validParams);

      expect(subscriptionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          pausedAt: null,
        }),
      );
    });

    it("should update status from Stripe response", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.resumeSubscription.mockResolvedValue(mockResumedSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "active" });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.resumeSubscription(validParams);

      expect(subscriptionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: validParams.id,
          status: "active",
          pausedAt: null,
        }),
      );
    });
  });

  describe("changePlan", () => {
    const validParams = {
      id: MOCK_DB_SUBSCRIPTION.id,
      companyId: TEST_IDS.companyId,
      newPriceId: "new_price_db_123",
    };

    const newStripePrice: StripePrice = {
      ...MOCK_STRIPE_PRICE,
      id: validParams.newPriceId,
      stripePriceId: "price_new_stripe_123",
    };

    const mockUpdatedSubscription: Stripe.Subscription = {
      ...MOCK_SUBSCRIPTION,
      items: {
        ...MOCK_SUBSCRIPTION.items,
        data: [
          {
            ...MOCK_SUBSCRIPTION.items.data[0],
            current_period_start: 1704067200, // Unix timestamp
            current_period_end: 1706745600, // Unix timestamp
          },
        ],
      },
    };

    it("should change plan successfully", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
      subscriptionRepository.updatePrice.mockResolvedValue(undefined);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const result = await service.changePlan(validParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(stripePriceRepository.findById).toHaveBeenCalledWith({ id: validParams.newPriceId });
      expect(stripeSubscriptionService.updateSubscription).toHaveBeenCalledWith({
        subscriptionId: MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
        priceId: newStripePrice.stripePriceId,
        prorationBehavior: "create_prorations",
      });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.changePlan(validParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(stripePriceRepository.findById).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentCustomer = { ...MOCK_BILLING_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.changePlan(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripePriceRepository.findById).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when new price does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(null);

      await expect(service.changePlan(validParams)).rejects.toThrow(
        new HttpException("Price not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeSubscriptionService.updateSubscription).not.toHaveBeenCalled();
    });

    it("should use create_prorations proration behavior", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
      subscriptionRepository.updatePrice.mockResolvedValue(undefined);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.changePlan(validParams);

      expect(stripeSubscriptionService.updateSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          prorationBehavior: "create_prorations",
        }),
      );
    });

    it("should update price relationship in database", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
      subscriptionRepository.updatePrice.mockResolvedValue(undefined);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.changePlan(validParams);

      expect(subscriptionRepository.updatePrice).toHaveBeenCalledWith({
        id: validParams.id,
        newPriceId: validParams.newPriceId,
      });
    });

    it("should convert Unix timestamps for period dates (multiply by 1000)", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
      subscriptionRepository.updatePrice.mockResolvedValue(undefined);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.changePlan(validParams);

      expect(subscriptionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPeriodStart: new Date(1704067200 * 1000),
          currentPeriodEnd: new Date(1706745600 * 1000),
        }),
      );
    });

    it("should update price before updating period dates", async () => {
      const callOrder: string[] = [];
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
      subscriptionRepository.updatePrice.mockImplementation(async () => {
        callOrder.push("updatePrice");
      });
      subscriptionRepository.update.mockImplementation(async () => {
        callOrder.push("update");
        return MOCK_DB_SUBSCRIPTION;
      });
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.changePlan(validParams);

      expect(callOrder).toEqual(["updatePrice", "update"]);
    });
  });

  describe("previewProration", () => {
    const validParams = {
      id: MOCK_DB_SUBSCRIPTION.id,
      companyId: TEST_IDS.companyId,
      newPriceId: "new_price_db_123",
    };

    const newStripePrice: StripePrice = {
      ...MOCK_STRIPE_PRICE,
      id: validParams.newPriceId,
      stripePriceId: "price_new_stripe_123",
    };

    const mockUpcomingInvoice: Stripe.UpcomingInvoice = {
      ...MOCK_INVOICE,
      subtotal: 500,
      total: 550,
      amount_due: 550,
      currency: "usd",
      lines: {
        object: "list",
        data: [
          {
            id: "il_test_1",
            object: "line_item",
            amount: 999,
            currency: "usd",
            description: "Remaining time on 1 × Monthly Plan (at $9.99 / month)",
            proration: true,
            period: {
              start: 1704067200,
              end: 1706745600,
            },
            livemode: false,
            metadata: {},
            price: MOCK_PRICE_RECURRING,
            quantity: 1,
            subscription: TEST_IDS.subscriptionId,
            type: "invoiceitem",
          } as any,
          {
            id: "il_test_2",
            object: "line_item",
            amount: -449,
            currency: "usd",
            description: "Unused time on 1 × Monthly Plan (at $9.99 / month)",
            proration: true,
            period: {
              start: 1704067200,
              end: 1706745600,
            },
            livemode: false,
            metadata: {},
            price: MOCK_PRICE_RECURRING,
            quantity: 1,
            subscription: TEST_IDS.subscriptionId,
            type: "invoiceitem",
          } as any,
        ],
        has_more: false,
        url: "/v1/invoices/upcoming/lines",
      },
    };

    it("should preview proration successfully", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionService.previewProration.mockResolvedValue(mockUpcomingInvoice);

      const result = await service.previewProration(validParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(stripePriceRepository.findById).toHaveBeenCalledWith({ id: validParams.newPriceId });
      expect(stripeSubscriptionService.previewProration).toHaveBeenCalledWith(
        MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
        newStripePrice.stripePriceId,
      );
      expect(result).toEqual({
        subtotal: 500,
        total: 550,
        amountDue: 550,
        currency: "usd",
        lines: [
          {
            description: "Remaining time on 1 × Monthly Plan (at $9.99 / month)",
            amount: 999,
            proration: true,
          },
          {
            description: "Unused time on 1 × Monthly Plan (at $9.99 / month)",
            amount: -449,
            proration: true,
          },
        ],
      });
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.previewProration(validParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeSubscriptionService.previewProration).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentCustomer = { ...MOCK_BILLING_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.previewProration(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripeSubscriptionService.previewProration).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when new price does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(null);

      await expect(service.previewProration(validParams)).rejects.toThrow(
        new HttpException("Price not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeSubscriptionService.previewProration).not.toHaveBeenCalled();
    });

    it("should format line items correctly", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionService.previewProration.mockResolvedValue(mockUpcomingInvoice);

      const result = await service.previewProration(validParams);

      expect(result.lines).toHaveLength(2);
      expect(result.lines[0]).toEqual(
        expect.objectContaining({
          description: expect.any(String),
          amount: expect.any(Number),
          proration: expect.any(Boolean),
        }),
      );
    });

    it("should return formatted preview with all required fields", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionService.previewProration.mockResolvedValue(mockUpcomingInvoice);

      const result = await service.previewProration(validParams);

      expect(result).toHaveProperty("subtotal");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("amountDue");
      expect(result).toHaveProperty("currency");
      expect(result).toHaveProperty("lines");
      expect(Array.isArray(result.lines)).toBe(true);
    });
  });

  describe("syncSubscriptionFromStripe", () => {
    const validParams = {
      stripeSubscriptionId: TEST_IDS.subscriptionId,
    };

    const mockStripeSubscriptionForSync: Stripe.Subscription = {
      ...MOCK_SUBSCRIPTION,
      status: "active",
      items: {
        ...MOCK_SUBSCRIPTION.items,
        data: [
          {
            ...MOCK_SUBSCRIPTION.items.data[0],
            current_period_start: 1704067200, // Unix timestamp
            current_period_end: 1706745600, // Unix timestamp
          },
        ],
      },
      cancel_at_period_end: false,
      canceled_at: null,
      trial_start: null,
      trial_end: null,
    };

    it("should sync subscription from Stripe when it exists in database", async () => {
      stripeSubscriptionService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      subscriptionRepository.updateByStripeSubscriptionId.mockResolvedValue(undefined);

      await service.syncSubscriptionFromStripe(validParams);

      expect(stripeSubscriptionService.retrieveSubscription).toHaveBeenCalledWith(validParams.stripeSubscriptionId);
      expect(subscriptionRepository.findByStripeSubscriptionId).toHaveBeenCalledWith({
        stripeSubscriptionId: validParams.stripeSubscriptionId,
      });
      expect(subscriptionRepository.updateByStripeSubscriptionId).toHaveBeenCalled();
    });

    it("should not update when subscription does not exist in database", async () => {
      stripeSubscriptionService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(null);

      await service.syncSubscriptionFromStripe(validParams);

      expect(stripeSubscriptionService.retrieveSubscription).toHaveBeenCalledWith(validParams.stripeSubscriptionId);
      expect(subscriptionRepository.findByStripeSubscriptionId).toHaveBeenCalledWith({
        stripeSubscriptionId: validParams.stripeSubscriptionId,
      });
      expect(subscriptionRepository.updateByStripeSubscriptionId).not.toHaveBeenCalled();
    });

    it("should convert Unix timestamps to Date objects (multiply by 1000)", async () => {
      stripeSubscriptionService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      subscriptionRepository.updateByStripeSubscriptionId.mockResolvedValue(undefined);

      await service.syncSubscriptionFromStripe(validParams);

      expect(subscriptionRepository.updateByStripeSubscriptionId).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPeriodStart: new Date(1704067200 * 1000),
          currentPeriodEnd: new Date(1706745600 * 1000),
        }),
      );
    });

    it("should handle null canceledAt", async () => {
      stripeSubscriptionService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      subscriptionRepository.updateByStripeSubscriptionId.mockResolvedValue(undefined);

      await service.syncSubscriptionFromStripe(validParams);

      expect(subscriptionRepository.updateByStripeSubscriptionId).toHaveBeenCalledWith(
        expect.objectContaining({
          canceledAt: null,
        }),
      );
    });

    it("should convert canceledAt Unix timestamp when present", async () => {
      const subscriptionWithCanceledAt: Stripe.Subscription = {
        ...mockStripeSubscriptionForSync,
        canceled_at: 1704067200,
      };
      stripeSubscriptionService.retrieveSubscription.mockResolvedValue(subscriptionWithCanceledAt);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      subscriptionRepository.updateByStripeSubscriptionId.mockResolvedValue(undefined);

      await service.syncSubscriptionFromStripe(validParams);

      expect(subscriptionRepository.updateByStripeSubscriptionId).toHaveBeenCalledWith(
        expect.objectContaining({
          canceledAt: new Date(1704067200 * 1000),
        }),
      );
    });

    it("should handle trial dates with Unix timestamp conversion", async () => {
      const subscriptionWithTrial: Stripe.Subscription = {
        ...mockStripeSubscriptionForSync,
        trial_start: 1704067200,
        trial_end: 1706745600,
      };
      stripeSubscriptionService.retrieveSubscription.mockResolvedValue(subscriptionWithTrial);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      subscriptionRepository.updateByStripeSubscriptionId.mockResolvedValue(undefined);

      await service.syncSubscriptionFromStripe(validParams);

      expect(subscriptionRepository.updateByStripeSubscriptionId).toHaveBeenCalledWith(
        expect.objectContaining({
          trialStart: new Date(1704067200 * 1000),
          trialEnd: new Date(1706745600 * 1000),
        }),
      );
    });

    it("should pass undefined for trial dates when not present", async () => {
      stripeSubscriptionService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      subscriptionRepository.updateByStripeSubscriptionId.mockResolvedValue(undefined);

      await service.syncSubscriptionFromStripe(validParams);

      expect(subscriptionRepository.updateByStripeSubscriptionId).toHaveBeenCalledWith(
        expect.objectContaining({
          trialStart: undefined,
          trialEnd: undefined,
        }),
      );
    });

    it("should update all subscription fields from Stripe", async () => {
      stripeSubscriptionService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      subscriptionRepository.updateByStripeSubscriptionId.mockResolvedValue(undefined);

      await service.syncSubscriptionFromStripe(validParams);

      expect(subscriptionRepository.updateByStripeSubscriptionId).toHaveBeenCalledWith({
        stripeSubscriptionId: validParams.stripeSubscriptionId,
        status: mockStripeSubscriptionForSync.status,
        currentPeriodStart: new Date(1704067200 * 1000),
        currentPeriodEnd: new Date(1706745600 * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialStart: undefined,
        trialEnd: undefined,
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle concurrent requests for same subscription", async () => {
      const validParams = { id: MOCK_DB_SUBSCRIPTION.id, companyId: TEST_IDS.companyId };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      const promises = [
        service.getSubscription(validParams),
        service.getSubscription(validParams),
        service.getSubscription(validParams),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(subscriptionRepository.findById).toHaveBeenCalledTimes(3);
    });

    it("should handle empty string company ID gracefully", async () => {
      const params = { companyId: "", query: {} };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.listSubscriptions(params)).rejects.toThrow(
        new HttpException("Billing customer not found for this company", HttpStatus.NOT_FOUND),
      );
    });

    it("should preserve exact Stripe IDs in all operations", async () => {
      const exactStripeId = "sub_exact_test_123456";
      const subscription = { ...MOCK_DB_SUBSCRIPTION, stripeSubscriptionId: exactStripeId };
      const validParams = { id: subscription.id, companyId: TEST_IDS.companyId };

      subscriptionRepository.findById.mockResolvedValue(subscription);
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripeSubscriptionService.cancelSubscription.mockResolvedValue(MOCK_SUBSCRIPTION);
      subscriptionRepository.update.mockResolvedValue(subscription);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE);

      await service.cancelSubscription(validParams);

      expect(stripeSubscriptionService.cancelSubscription).toHaveBeenCalledWith(exactStripeId, true);
    });

    it("should handle Stripe API errors gracefully", async () => {
      const validParams = {
        companyId: TEST_IDS.companyId,
        priceId: MOCK_STRIPE_PRICE.id,
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      const stripeError = new Error("Stripe API error");
      stripeSubscriptionService.createSubscription.mockRejectedValue(stripeError);

      await expect(service.createSubscription(validParams)).rejects.toThrow("Stripe API error");

      expect(subscriptionRepository.create).not.toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      const validParams = {
        companyId: TEST_IDS.companyId,
        priceId: MOCK_STRIPE_PRICE.id,
      };
      billingCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_BILLING_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionService.createSubscription.mockResolvedValue({
        ...MOCK_SUBSCRIPTION,
        items: {
          ...MOCK_SUBSCRIPTION.items,
          data: [
            {
              ...MOCK_SUBSCRIPTION.items.data[0],
              current_period_start: 1704067200,
              current_period_end: 1706745600,
            },
          ],
        },
      });
      const dbError = new Error("Database error");
      subscriptionRepository.create.mockRejectedValue(dbError);

      await expect(service.createSubscription(validParams)).rejects.toThrow("Database error");

      expect(stripeSubscriptionService.createSubscription).toHaveBeenCalled();
    });
  });
});
