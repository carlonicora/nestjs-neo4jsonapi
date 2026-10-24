import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the barrel export to provide the imports that StripeSubscriptionAdminService needs
vi.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = vi.importActual("@carlonicora/nestjs-neo4jsonapi");

  return {
    ...actual,
    // Override companyMeta that billing-customer.model needs
    companyMeta: {
      type: "companies",
      endpoint: "companies",
      nodeName: "company",
      labelName: "Company",
    },
    // Mock StripeSubscriptionApiService to avoid dependency resolution issues
    StripeSubscriptionApiService: vi.fn().mockImplementation(() => ({
      createSubscription: vi.fn(),
      retrieveSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      cancelUnpaidAttempt: vi.fn(),
      updateSubscription: vi.fn(),
      previewProration: vi.fn(),
    })),
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import Stripe from "stripe";
import { StripeSubscriptionAdminService } from "../stripe-subscription-admin.service";
import { StripeSubscriptionRepository } from "../../repositories/stripe-subscription.repository";
import { StripeCustomerRepository } from "../../../stripe-customer/repositories/stripe-customer.repository";
import { StripePriceRepository } from "../../../stripe-price/repositories/stripe-price.repository";
import { JsonApiService } from "../../../../core/jsonapi";
import { StripeSubscriptionApiService } from "../stripe-subscription-api.service";
import { StripeCustomerApiService } from "../../../stripe-customer/services/stripe-customer-api.service";
import { StripePaymentService } from "../../../stripe/services/stripe.payment.service";
import { StripeCouponCodeCheckoutService } from "../../../stripe-coupon/services/stripe-coupon-code-checkout.service";
import {
  StripeSubscription,
  StripeSubscriptionDescriptor,
  StripeSubscriptionStatus,
} from "../../entities/stripe-subscription";
import { ClsService } from "nestjs-cls";
import { StripeCustomer } from "../../../stripe-customer/entities/stripe-customer.entity";
import { StripePrice } from "../../../stripe-price/entities/stripe-price.entity";
import { StripeProduct } from "../../../stripe-product/entities/stripe-product.entity";
import { Company } from "../../../company/entities/company";
import {
  MOCK_SUBSCRIPTION,
  MOCK_PRICE_RECURRING,
  MOCK_INVOICE,
  MOCK_PAYMENT_METHOD,
  TEST_IDS,
} from "../../../stripe/__tests__/fixtures/stripe.fixtures";

describe("StripeSubscriptionAdminService", () => {
  let service: StripeSubscriptionAdminService;
  let subscriptionRepository: Mocked<StripeSubscriptionRepository>;
  let stripeCustomerRepository: Mocked<StripeCustomerRepository>;
  let stripePriceRepository: Mocked<StripePriceRepository>;
  let stripeSubscriptionApiService: Mocked<StripeSubscriptionApiService>;
  let stripeCustomerApiService: Mocked<StripeCustomerApiService>;
  let stripePaymentService: Mocked<StripePaymentService>;
  let jsonApiService: Mocked<JsonApiService>;

  // Test data constants
  const MOCK_STRIPE_CUSTOMER: StripeCustomer = {
    id: "stripe_customer_123",
    type: "stripe-customers",
    stripeCustomerId: TEST_IDS.customerId,
    email: "test@example.com",
    name: "Test Customer",
    currency: "usd",
    balance: 0,
    delinquent: false,
    defaultPaymentMethodId: TEST_IDS.paymentMethodId,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    company: {} as Company,
  };

  const MOCK_STRIPE_PRICE: StripePrice = {
    id: "price_db_123",
    stripePriceId: TEST_IDS.priceId,
    active: true,
    currency: "usd",
    unitAmount: 999,
    type: "recurring",
    priceType: "recurring",
    recurringInterval: "month",
    recurringIntervalCount: 1,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    stripeProduct: {} as StripeProduct,
  };

  const MOCK_DB_SUBSCRIPTION: StripeSubscription = {
    id: "subscription_db_123",
    type: "stripe-subscriptions",
    stripeSubscriptionId: TEST_IDS.subscriptionId,
    stripeSubscriptionItemId: "si_test_123",
    status: "active",
    currentPeriodStart: new Date("2025-01-01T00:00:00Z"),
    currentPeriodEnd: new Date("2025-02-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    quantity: 1,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    stripeCustomer: MOCK_STRIPE_CUSTOMER,
    stripePrice: MOCK_STRIPE_PRICE,
    company: {} as Company,
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
    const mockStripeSubscriptionRepository = {
      findById: vi.fn(),
      findByStripeCustomerId: vi.fn(),
      findByStripeSubscriptionId: vi.fn(),
      createSubscription: vi.fn(),
      update: vi.fn(),
      updatePrice: vi.fn(),
      updateByStripeSubscriptionId: vi.fn(),
    };

    const mockStripeCustomerRepository = {
      findByCompanyId: vi.fn(),
      findById: vi.fn(),
    };

    const mockStripePriceRepository = {
      findById: vi.fn(),
    };

    const mockStripeSubscriptionApiService = {
      createSubscription: vi.fn(),
      retrieveSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      cancelUnpaidAttempt: vi.fn(),
      updateSubscription: vi.fn(),
      previewProration: vi.fn(),
    };

    const mockStripeCustomerApiService = {
      createCustomer: vi.fn(),
      retrieveCustomer: vi.fn(),
      updateCustomer: vi.fn(),
      deleteCustomer: vi.fn(),
      listPaymentMethods: vi.fn(),
      setDefaultPaymentMethod: vi.fn(),
    };

    const mockStripePaymentService = {
      createPaymentIntent: vi.fn(),
      confirmPaymentIntent: vi.fn(),
      createAndPayOneTimeInvoice: vi.fn(),
      retrievePaymentIntent: vi.fn(),
      cancelPaymentIntent: vi.fn(),
      createSetupIntent: vi.fn(),
      retrieveSetupIntent: vi.fn(),
      retrievePaymentMethod: vi.fn(),
    };

    const mockJsonApiService = {
      buildSingle: vi.fn(),
      buildList: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeSubscriptionAdminService,
        {
          provide: StripeSubscriptionRepository,
          useValue: mockStripeSubscriptionRepository,
        },
        {
          provide: StripeCustomerRepository,
          useValue: mockStripeCustomerRepository,
        },
        {
          provide: StripePriceRepository,
          useValue: mockStripePriceRepository,
        },
        {
          provide: StripeSubscriptionApiService,
          useValue: mockStripeSubscriptionApiService,
        },
        {
          provide: StripeCustomerApiService,
          useValue: mockStripeCustomerApiService,
        },
        {
          provide: StripePaymentService,
          useValue: mockStripePaymentService,
        },
        {
          provide: JsonApiService,
          useValue: mockJsonApiService,
        },
        { provide: ClsService, useValue: {} },
        {
          provide: StripeCouponCodeCheckoutService,
          useValue: {
            findAutomaticForPrice: vi.fn().mockResolvedValue(null),
            isExhausted: vi.fn().mockResolvedValue(false),
            refreshCountsByStripePromotionCodeId: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<StripeSubscriptionAdminService>(StripeSubscriptionAdminService);
    subscriptionRepository = module.get(StripeSubscriptionRepository);
    stripeCustomerRepository = module.get(StripeCustomerRepository);
    stripePriceRepository = module.get(StripePriceRepository);
    stripeSubscriptionApiService = module.get(StripeSubscriptionApiService);
    stripeCustomerApiService = module.get(StripeCustomerApiService);
    stripePaymentService = module.get(StripePaymentService);
    jsonApiService = module.get(JsonApiService);

    // Default mock for listPaymentMethods - return payment method, tests that need empty array can override
    stripeCustomerApiService.listPaymentMethods.mockResolvedValue([MOCK_PAYMENT_METHOD]);
    // Default: the customer has no existing subscriptions, so the duplicate-recurring guard passes
    subscriptionRepository.findByStripeCustomerId.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("listSubscriptions", () => {
    const validParams = {
      companyId: TEST_IDS.companyId,
      query: { page: { number: 1, size: 10 } },
    };

    it("should return paginated subscriptions list", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([MOCK_DB_SUBSCRIPTION]);
      jsonApiService.buildList.mockResolvedValue(MOCK_JSON_API_LIST_RESPONSE);

      const result = await service.listSubscriptions(validParams);

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validParams.companyId,
      });
      expect(subscriptionRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.id,
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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.listSubscriptions(validParams)).rejects.toThrow(
        new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(subscriptionRepository.findByStripeCustomerId).not.toHaveBeenCalled();
      expect(jsonApiService.buildList).not.toHaveBeenCalled();
    });

    it("should filter by status when provided", async () => {
      const paramsWithStatus = { ...validParams, status: "active" as StripeSubscriptionStatus };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([MOCK_DB_SUBSCRIPTION]);
      jsonApiService.buildList.mockResolvedValue(MOCK_JSON_API_LIST_RESPONSE);

      await service.listSubscriptions(paramsWithStatus);

      expect(subscriptionRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.id,
        status: "active",
      });
    });

    it("should use JsonApiPaginator with query params", async () => {
      const customQuery = { page: { number: 2, size: 20 } };
      const paramsWithCustomQuery = { ...validParams, query: customQuery };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([]);
      jsonApiService.buildList.mockResolvedValue({ data: [], meta: {} });

      await service.listSubscriptions(paramsWithCustomQuery);

      expect(jsonApiService.buildList).toHaveBeenCalledWith(
        expect.any(Object),
        [],
        expect.any(Object), // JsonApiPaginator instance
      );
    });

    it("should return empty list when no subscriptions exist", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([]);
      jsonApiService.buildList.mockResolvedValue({ data: [], meta: {} });

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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.getSubscription(validParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
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

      expect(stripeCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when customer does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.getSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentCustomer = { ...MOCK_STRIPE_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.getSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN with correct status code", async () => {
      const differentCustomer = { ...MOCK_STRIPE_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      try {
        await service.getSubscription(validParams);
        expect.unreachable("Should have thrown HttpException");
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

    it("createSubscription uses repository.createSubscription", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(subscriptionRepository.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ stripeCustomerId: MOCK_STRIPE_CUSTOMER.id, priceId: validParams.priceId }),
      );
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(StripeSubscriptionDescriptor.model, MOCK_DB_SUBSCRIPTION);
    });

    it("should create subscription successfully with minimal params", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.createSubscription(validParams);

      expect(stripeCustomerRepository.findByCompanyId).toHaveBeenCalledWith({
        companyId: validParams.companyId,
      });
      expect(stripePriceRepository.findById).toHaveBeenCalledWith({ id: validParams.priceId });
      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        priceId: MOCK_STRIPE_PRICE.stripePriceId,
        paymentMethodId: MOCK_PAYMENT_METHOD.id,
        trialPeriodDays: undefined,
        metadata: {
          companyId: validParams.companyId,
          priceId: validParams.priceId,
        },
      });
      expect(result).toEqual({
        data: MOCK_JSON_API_RESPONSE,
        clientSecret: null,
        paymentIntentId: null,
        requiresAction: false,
      });
    });

    it("returns the client secret of an incomplete subscription's open invoice (current Stripe API shape)", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue({
        ...mockStripeSubscriptionWithItem,
        status: "incomplete",
        latest_invoice: {
          id: "in_1",
          status: "open",
          confirmation_secret: { client_secret: "pi_1_secret", type: "payment_intent" },
          payments: { data: [{ is_default: true, payment: { type: "payment_intent", payment_intent: "pi_1" } }] },
        },
      } as unknown as Stripe.Subscription);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.createSubscription(validParams);

      expect(result).toEqual({
        data: MOCK_JSON_API_RESPONSE,
        clientSecret: "pi_1_secret",
        paymentIntentId: "pi_1",
        requiresAction: true,
      });
    });

    it("should throw NOT_FOUND when customer does not exist", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.createSubscription(validParams)).rejects.toThrow(
        new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND),
      );

      expect(stripePriceRepository.findById).not.toHaveBeenCalled();
      expect(stripeSubscriptionApiService.createSubscription).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when price does not exist", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(null);

      await expect(service.createSubscription(validParams)).rejects.toThrow(
        new HttpException("Price not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeSubscriptionApiService.createSubscription).not.toHaveBeenCalled();
    });

    it("should throw CONFLICT when the customer already has an active recurring subscription for the same price", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([MOCK_DB_SUBSCRIPTION]);

      const error = await service.createSubscription(validParams).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect(subscriptionRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.id,
      });
      expect(stripeSubscriptionApiService.createSubscription).not.toHaveBeenCalled();
      expect(subscriptionRepository.createSubscription).not.toHaveBeenCalled();
    });

    it("should proceed when the customer has no active recurring subscription", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      // Same price, but canceled: not a duplicate.
      const canceled: StripeSubscription = { ...MOCK_DB_SUBSCRIPTION, status: "canceled" };
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([canceled]);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.createSubscription(validParams);

      expect(subscriptionRepository.findByStripeCustomerId).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.id,
      });
      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should convert Unix timestamps to Date objects (multiply by 1000)", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(subscriptionRepository.createSubscription).toHaveBeenCalledWith(
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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(subscriptionWithTrial);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription({ ...validParams, trialPeriodDays: 30 });

      expect(subscriptionRepository.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          trialStart: new Date(1704067200 * 1000),
          trialEnd: new Date(1706745600 * 1000),
        }),
      );
    });

    it("should pass undefined for trial dates when not present", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(subscriptionRepository.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          trialStart: undefined,
          trialEnd: undefined,
        }),
      );
    });

    it("should default quantity to 1 when not provided", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(subscriptionRepository.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 1,
        }),
      );
    });

    it("should use provided quantity when specified", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription({ ...validParams, quantity: 5 });

      expect(subscriptionRepository.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 5,
        }),
      );
    });

    it("should create subscription in Stripe before database", async () => {
      const callOrder: string[] = [];
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockImplementation(async () => {
        callOrder.push("stripe");
        return mockStripeSubscriptionWithItem;
      });
      subscriptionRepository.createSubscription.mockImplementation(async () => {
        callOrder.push("database");
        return MOCK_DB_SUBSCRIPTION;
      });
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(callOrder).toEqual(["stripe", "database"]);
    });

    it("should include metadata with companyId and priceId", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(validParams);

      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalledWith(
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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.createSubscription(paramsWithPaymentMethod);

      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethodId: TEST_IDS.paymentMethodId,
        }),
      );
    });

    it("should return JSON:API formatted response with SCA metadata", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(mockStripeSubscriptionWithItem);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.createSubscription(validParams);

      expect(result).toEqual({
        data: MOCK_JSON_API_RESPONSE,
        clientSecret: null,
        paymentIntentId: null,
        requiresAction: false,
      });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.any(Object), MOCK_DB_SUBSCRIPTION);
    });
  });

  describe("createSubscription picks the card", () => {
    const params = { companyId: TEST_IDS.companyId, priceId: MOCK_STRIPE_PRICE.id };
    const secondCard = { ...MOCK_PAYMENT_METHOD, id: "pm_added_later" } as Stripe.PaymentMethod;

    beforeEach(() => {
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue({
        ...MOCK_SUBSCRIPTION,
        items: {
          ...MOCK_SUBSCRIPTION.items,
          data: [
            { ...MOCK_SUBSCRIPTION.items.data[0], current_period_start: 1704067200, current_period_end: 1706745600 },
          ],
        },
      } as Stripe.Subscription);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);
      stripeCustomerApiService.listPaymentMethods.mockResolvedValue([MOCK_PAYMENT_METHOD, secondCard]);
    });

    it("uses the customer default, not the first card", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue({
        ...MOCK_STRIPE_CUSTOMER,
        defaultPaymentMethodId: secondCard.id,
      });

      await service.createSubscription(params);

      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethodId: secondCard.id }),
      );
    });

    it("falls back to the first card without a default", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue({
        ...MOCK_STRIPE_CUSTOMER,
        defaultPaymentMethodId: undefined,
      });

      await service.createSubscription(params);

      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethodId: MOCK_PAYMENT_METHOD.id }),
      );
    });

    it("falls back to the first card when the default is no longer attached", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue({
        ...MOCK_STRIPE_CUSTOMER,
        defaultPaymentMethodId: "pm_detached",
      });

      await service.createSubscription(params);

      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethodId: MOCK_PAYMENT_METHOD.id }),
      );
    });

    it("keeps the card the request names", async () => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue({
        ...MOCK_STRIPE_CUSTOMER,
        defaultPaymentMethodId: secondCard.id,
      });

      await service.createSubscription({ ...params, paymentMethodId: "pm_named" });

      expect(stripeCustomerApiService.listPaymentMethods).not.toHaveBeenCalled();
      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethodId: "pm_named" }),
      );
    });
  });

  describe("createSubscription cleans up unpaid attempts", () => {
    const params = { companyId: TEST_IDS.companyId, priceId: MOCK_STRIPE_PRICE.id };
    const createdStripeSubscription: Stripe.Subscription = {
      ...MOCK_SUBSCRIPTION,
      items: {
        ...MOCK_SUBSCRIPTION.items,
        data: [
          { ...MOCK_SUBSCRIPTION.items.data[0], current_period_start: 1704067200, current_period_end: 1706745600 },
        ],
      },
    };
    const unpaid = (id: string): StripeSubscription => ({
      ...MOCK_DB_SUBSCRIPTION,
      id,
      stripeSubscriptionId: `sub_stripe_${id}`,
      status: "incomplete",
    });
    const canceledInStripe = (id: string) =>
      ({
        ...MOCK_SUBSCRIPTION,
        id: `sub_stripe_${id}`,
        status: "canceled",
        canceled_at: 1704067200,
      }) as Stripe.Subscription;

    beforeEach(() => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue(createdStripeSubscription);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);
    });

    it("cancels every incomplete recurring subscription in Stripe at once and stores the cancellation, before creating the new one", async () => {
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([unpaid("a"), unpaid("b")]);
      stripeSubscriptionApiService.cancelUnpaidAttempt.mockImplementation(async (stripeId: string) =>
        canceledInStripe(stripeId.replace("sub_stripe_", "")),
      );

      await service.createSubscription(params);

      expect(stripeSubscriptionApiService.cancelUnpaidAttempt).toHaveBeenCalledTimes(2);
      expect(stripeSubscriptionApiService.cancelUnpaidAttempt).toHaveBeenCalledWith("sub_stripe_a");
      expect(stripeSubscriptionApiService.cancelUnpaidAttempt).toHaveBeenCalledWith("sub_stripe_b");
      expect(subscriptionRepository.update).toHaveBeenCalledWith({
        id: "a",
        status: "canceled",
        cancelAtPeriodEnd: MOCK_SUBSCRIPTION.cancel_at_period_end,
        canceledAt: new Date(1704067200 * 1000),
      });
      expect(subscriptionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: "b", status: "canceled" }),
      );

      const lastCancel = Math.max(...stripeSubscriptionApiService.cancelUnpaidAttempt.mock.invocationCallOrder);
      expect(stripeSubscriptionApiService.createSubscription.mock.invocationCallOrder[0]).toBeGreaterThan(lastCancel);
    });

    it("never touches past_due, canceled or one-time purchases", async () => {
      const oneTime: StripeSubscription = {
        ...unpaid("one-time"),
        stripePrice: { ...MOCK_STRIPE_PRICE, priceType: "one_time" },
      };
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([
        { ...MOCK_DB_SUBSCRIPTION, id: "pd", status: "past_due" },
        { ...MOCK_DB_SUBSCRIPTION, id: "c", status: "canceled" },
        { ...MOCK_DB_SUBSCRIPTION, id: "x", status: "incomplete_expired" },
        oneTime,
      ]);

      await service.createSubscription(params);

      expect(stripeSubscriptionApiService.cancelUnpaidAttempt).not.toHaveBeenCalled();
      expect(subscriptionRepository.update).not.toHaveBeenCalled();
      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalledTimes(1);
    });

    it("does not cancel anything when the customer already has an active subscription (409)", async () => {
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([MOCK_DB_SUBSCRIPTION, unpaid("a")]);

      await expect(service.createSubscription(params)).rejects.toBeInstanceOf(HttpException);

      expect(stripeSubscriptionApiService.cancelUnpaidAttempt).not.toHaveBeenCalled();
    });

    it("a failed cancellation re-reads that subscription from Stripe and still creates the new one", async () => {
      subscriptionRepository.findByStripeCustomerId.mockResolvedValue([unpaid("a")]);
      stripeSubscriptionApiService.cancelUnpaidAttempt.mockRejectedValue(new Error("already expired"));
      stripeSubscriptionApiService.retrieveSubscription.mockResolvedValue({
        ...createdStripeSubscription,
        id: "sub_stripe_a",
        status: "incomplete_expired",
      } as Stripe.Subscription);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(unpaid("a"));

      const result = await service.createSubscription(params);

      expect(stripeSubscriptionApiService.retrieveSubscription).toHaveBeenCalledWith("sub_stripe_a");
      expect(subscriptionRepository.updateByStripeSubscriptionId).toHaveBeenCalledWith(
        expect.objectContaining({ stripeSubscriptionId: "sub_stripe_a", status: "incomplete_expired" }),
      );
      expect(subscriptionRepository.update).not.toHaveBeenCalled();
      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("does not cancel anything for a one-time purchase", async () => {
      stripePriceRepository.findById.mockResolvedValue({ ...MOCK_STRIPE_PRICE, priceType: "one_time" });
      stripePaymentService.createAndPayOneTimeInvoice.mockResolvedValue({
        paymentIntent: { id: "pi_1", status: "succeeded", client_secret: null },
      } as any);

      await service.createSubscription(params);

      expect(subscriptionRepository.findByStripeCustomerId).not.toHaveBeenCalled();
      expect(stripeSubscriptionApiService.cancelSubscription).not.toHaveBeenCalled();
    });
  });

  describe("createSubscription one-time purchase", () => {
    const MOCK_ONE_TIME_PRICE: StripePrice = {
      ...MOCK_STRIPE_PRICE,
      id: "price_db_one_time",
      stripePriceId: "price_one_time_1",
      currency: "eur",
      unitAmount: 500,
      type: "one_time",
      priceType: "one_time",
      recurringInterval: undefined,
      recurringIntervalCount: undefined,
      nickname: "Top-up",
    };

    const oneTimeParams = {
      companyId: TEST_IDS.companyId,
      priceId: MOCK_ONE_TIME_PRICE.id,
      paymentMethodId: TEST_IDS.paymentMethodId,
      quantity: 3,
    };

    beforeEach(() => {
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_ONE_TIME_PRICE);
      subscriptionRepository.createSubscription.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);
    });

    it("one-time purchase is charged through an invoice and recorded under the payment intent id", async () => {
      stripePaymentService.createAndPayOneTimeInvoice.mockResolvedValue({
        invoiceId: "in_1",
        paymentIntent: { id: "pi_1", status: "succeeded", client_secret: "pi_1_secret" } as Stripe.PaymentIntent,
      });

      const result = await service.createSubscription(oneTimeParams);

      expect(stripePaymentService.createAndPayOneTimeInvoice).toHaveBeenCalledWith({
        stripeCustomerId: MOCK_STRIPE_CUSTOMER.stripeCustomerId,
        stripePriceId: MOCK_ONE_TIME_PRICE.stripePriceId,
        quantity: 3,
        currency: MOCK_ONE_TIME_PRICE.currency,
        description: "One-time purchase: Top-up",
        metadata: { companyId: TEST_IDS.companyId, priceId: MOCK_ONE_TIME_PRICE.id, type: "one_time_purchase" },
        paymentMethodId: TEST_IDS.paymentMethodId,
      });
      expect(stripePaymentService.createPaymentIntent).not.toHaveBeenCalled();
      expect(stripePaymentService.confirmPaymentIntent).not.toHaveBeenCalled();
      expect(stripeSubscriptionApiService.createSubscription).not.toHaveBeenCalled();
      expect(subscriptionRepository.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeCustomerId: MOCK_STRIPE_CUSTOMER.id,
          priceId: MOCK_ONE_TIME_PRICE.id,
          stripeSubscriptionId: "pi_1",
          status: "active",
          quantity: 3,
        }),
      );
      expect(result).toEqual({
        data: MOCK_JSON_API_RESPONSE,
        clientSecret: null,
        paymentIntentId: "pi_1",
        requiresAction: false,
      });
    });

    it("one-time purchase needing card authentication is recorded incomplete with the client secret", async () => {
      stripePaymentService.createAndPayOneTimeInvoice.mockResolvedValue({
        invoiceId: "in_1",
        paymentIntent: { id: "pi_1", status: "requires_action", client_secret: "pi_1_secret" } as Stripe.PaymentIntent,
      });

      const result = await service.createSubscription(oneTimeParams);

      expect(subscriptionRepository.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ stripeSubscriptionId: "pi_1", status: "incomplete" }),
      );
      expect(result).toEqual({
        data: MOCK_JSON_API_RESPONSE,
        clientSecret: "pi_1_secret",
        paymentIntentId: "pi_1",
        requiresAction: true,
      });
      expect(stripePaymentService.createPaymentIntent).not.toHaveBeenCalled();
      expect(stripePaymentService.confirmPaymentIntent).not.toHaveBeenCalled();
    });

    it("one-time purchase uses the price description when it has one", async () => {
      stripePriceRepository.findById.mockResolvedValue({ ...MOCK_ONE_TIME_PRICE, description: "500 credits" });
      stripePaymentService.createAndPayOneTimeInvoice.mockResolvedValue({
        invoiceId: "in_1",
        paymentIntent: { id: "pi_1", status: "succeeded", client_secret: null } as Stripe.PaymentIntent,
      });

      await service.createSubscription(oneTimeParams);

      expect(stripePaymentService.createAndPayOneTimeInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ description: "500 credits" }),
      );
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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeSubscriptionApiService.cancelSubscription.mockResolvedValue(mockCanceledSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "canceled" });
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.cancelSubscription(validParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(stripeSubscriptionApiService.cancelSubscription).toHaveBeenCalledWith(
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

      expect(stripeCustomerRepository.findByCompanyId).not.toHaveBeenCalled();
      expect(stripeSubscriptionApiService.cancelSubscription).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when customer does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.cancelSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripeSubscriptionApiService.cancelSubscription).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentCustomer = { ...MOCK_STRIPE_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.cancelSubscription(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripeSubscriptionApiService.cancelSubscription).not.toHaveBeenCalled();
    });

    it("should cancel immediately when cancelImmediately is true", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeSubscriptionApiService.cancelSubscription.mockResolvedValue(mockCanceledSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "canceled" });
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.cancelSubscription({ ...validParams, cancelImmediately: true });

      expect(stripeSubscriptionApiService.cancelSubscription).toHaveBeenCalledWith(
        MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
        false, // !cancelImmediately (cancelAtPeriodEnd = false)
      );
    });

    it("should convert Unix timestamp for canceledAt (multiply by 1000)", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeSubscriptionApiService.cancelSubscription.mockResolvedValue(mockCanceledSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "canceled" });
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeSubscriptionApiService.cancelSubscription.mockResolvedValue(subscriptionWithoutCanceledAt);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.cancelSubscription(validParams);

      expect(subscriptionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          canceledAt: undefined,
        }),
      );
    });

    it("should update database with Stripe status and cancel_at_period_end", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeSubscriptionApiService.cancelSubscription.mockResolvedValue(mockCanceledSubscription);
      subscriptionRepository.update.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "canceled" });
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.cancelSubscription(validParams);

      expect(subscriptionRepository.update).toHaveBeenCalledWith({
        id: validParams.id,
        status: mockCanceledSubscription.status,
        cancelAtPeriodEnd: mockCanceledSubscription.cancel_at_period_end,
        canceledAt: new Date(mockCanceledSubscription.canceled_at! * 1000),
      });
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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionApiService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
      subscriptionRepository.updatePrice.mockResolvedValue(undefined);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.changePlan(validParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(stripePriceRepository.findById).toHaveBeenCalledWith({ id: validParams.newPriceId });
      expect(stripeSubscriptionApiService.updateSubscription).toHaveBeenCalledWith({
        subscriptionId: MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
        priceId: newStripePrice.stripePriceId,
        prorationBehavior: "create_prorations",
        defaultPaymentMethodId: MOCK_STRIPE_CUSTOMER.defaultPaymentMethodId,
      });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    describe("charges the customer default card", () => {
      const secondCard = { ...MOCK_PAYMENT_METHOD, id: "pm_added_later" } as Stripe.PaymentMethod;

      beforeEach(() => {
        stripePriceRepository.findById.mockResolvedValue(newStripePrice);
        stripeSubscriptionApiService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
        subscriptionRepository.updatePrice.mockResolvedValue(undefined);
        subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
        jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);
      });

      it("a trial upgrade sends the customer default, so a card saved on the subscription does not win", async () => {
        subscriptionRepository.findById.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "trialing" });
        stripeCustomerRepository.findByCompanyId.mockResolvedValue({
          ...MOCK_STRIPE_CUSTOMER,
          defaultPaymentMethodId: secondCard.id,
        });
        stripeCustomerApiService.listPaymentMethods.mockResolvedValue([MOCK_PAYMENT_METHOD, secondCard]);

        await service.changePlan(validParams);

        expect(stripeSubscriptionApiService.updateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ trialEnd: "now", defaultPaymentMethodId: secondCard.id }),
        );
      });

      it("a trial upgrade sends no card when the default is no longer attached", async () => {
        subscriptionRepository.findById.mockResolvedValue({ ...MOCK_DB_SUBSCRIPTION, status: "trialing" });
        stripeCustomerRepository.findByCompanyId.mockResolvedValue({
          ...MOCK_STRIPE_CUSTOMER,
          defaultPaymentMethodId: "pm_detached",
        });
        stripeCustomerApiService.listPaymentMethods.mockResolvedValue([MOCK_PAYMENT_METHOD]);

        await service.changePlan(validParams);

        expect(stripeSubscriptionApiService.updateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ defaultPaymentMethodId: undefined }),
        );
      });

      it("sends no card when the customer has no default", async () => {
        subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
        stripeCustomerRepository.findByCompanyId.mockResolvedValue({
          ...MOCK_STRIPE_CUSTOMER,
          defaultPaymentMethodId: undefined,
        });

        await service.changePlan(validParams);

        expect(stripeSubscriptionApiService.updateSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ defaultPaymentMethodId: undefined }),
        );
      });
    });

    it("adds the client secret to meta when the charge waits on 3D Secure", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionApiService.updateSubscription.mockResolvedValue({
        ...mockUpdatedSubscription,
        status: "past_due",
        latest_invoice: {
          id: "in_2",
          status: "open",
          confirmation_secret: { client_secret: "pi_2_secret", type: "payment_intent" },
          payments: { data: [{ is_default: true, payment: { type: "payment_intent", payment_intent: "pi_2" } }] },
        },
      } as unknown as Stripe.Subscription);
      subscriptionRepository.updatePrice.mockResolvedValue(undefined);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      const result = await service.changePlan(validParams);

      expect(result).toEqual({
        ...MOCK_JSON_API_RESPONSE,
        meta: { clientSecret: "pi_2_secret", paymentIntentId: "pi_2", requiresAction: true },
      });
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.changePlan(validParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(stripePriceRepository.findById).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentCustomer = { ...MOCK_STRIPE_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.changePlan(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripePriceRepository.findById).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when new price does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(null);

      await expect(service.changePlan(validParams)).rejects.toThrow(
        new HttpException("Price not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeSubscriptionApiService.updateSubscription).not.toHaveBeenCalled();
    });

    it("should use create_prorations proration behavior", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionApiService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
      subscriptionRepository.updatePrice.mockResolvedValue(undefined);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.changePlan(validParams);

      expect(stripeSubscriptionApiService.updateSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          prorationBehavior: "create_prorations",
        }),
      );
    });

    it("should update price relationship in database", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionApiService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
      subscriptionRepository.updatePrice.mockResolvedValue(undefined);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.changePlan(validParams);

      expect(subscriptionRepository.updatePrice).toHaveBeenCalledWith({
        id: validParams.id,
        newPriceId: validParams.newPriceId,
      });
    });

    it("should convert Unix timestamps for period dates (multiply by 1000)", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionApiService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
      subscriptionRepository.updatePrice.mockResolvedValue(undefined);
      subscriptionRepository.update.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionApiService.updateSubscription.mockResolvedValue(mockUpdatedSubscription);
      subscriptionRepository.updatePrice.mockImplementation(async () => {
        callOrder.push("updatePrice");
        return MOCK_DB_SUBSCRIPTION;
      });
      subscriptionRepository.update.mockImplementation(async () => {
        callOrder.push("update");
        return MOCK_DB_SUBSCRIPTION;
      });
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

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

    const mockUpcomingInvoice: Stripe.Invoice = {
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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionApiService.previewProration.mockResolvedValue(mockUpcomingInvoice);

      const result = await service.previewProration(validParams);

      expect(subscriptionRepository.findById).toHaveBeenCalledWith({ id: validParams.id });
      expect(stripePriceRepository.findById).toHaveBeenCalledWith({ id: validParams.newPriceId });
      expect(stripeSubscriptionApiService.previewProration).toHaveBeenCalledWith(
        MOCK_DB_SUBSCRIPTION.stripeSubscriptionId,
        newStripePrice.stripePriceId,
      );
      expect(result).toEqual({
        subtotal: 500,
        total: 550,
        amountDue: 550,
        immediateCharge: 550, // 999 + (-449) = 550
        currency: "usd",
        prorationDate: expect.any(Date),
        isTrialUpgrade: false,
        lines: [
          {
            description: "Remaining time on 1 × Monthly Plan (at $9.99 / month)",
            amount: 999,
            proration: true,
            period: {
              start: new Date(1704067200 * 1000),
              end: new Date(1706745600 * 1000),
            },
          },
          {
            description: "Unused time on 1 × Monthly Plan (at $9.99 / month)",
            amount: -449,
            proration: true,
            period: {
              start: new Date(1704067200 * 1000),
              end: new Date(1706745600 * 1000),
            },
          },
        ],
      });
    });

    it("should throw NOT_FOUND when subscription does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.previewProration(validParams)).rejects.toThrow(
        new HttpException("Subscription not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeSubscriptionApiService.previewProration).not.toHaveBeenCalled();
    });

    it("should throw FORBIDDEN when subscription does not belong to company", async () => {
      const differentCustomer = { ...MOCK_STRIPE_CUSTOMER, id: "different_customer_id" };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(differentCustomer);

      await expect(service.previewProration(validParams)).rejects.toThrow(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      expect(stripeSubscriptionApiService.previewProration).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when new price does not exist", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(null);

      await expect(service.previewProration(validParams)).rejects.toThrow(
        new HttpException("Price not found", HttpStatus.NOT_FOUND),
      );

      expect(stripeSubscriptionApiService.previewProration).not.toHaveBeenCalled();
    });

    it("should format line items correctly", async () => {
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionApiService.previewProration.mockResolvedValue(mockUpcomingInvoice);

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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(newStripePrice);
      stripeSubscriptionApiService.previewProration.mockResolvedValue(mockUpcomingInvoice);

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
      stripeSubscriptionApiService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      subscriptionRepository.updateByStripeSubscriptionId.mockResolvedValue(undefined);

      await service.syncSubscriptionFromStripe(validParams);

      expect(stripeSubscriptionApiService.retrieveSubscription).toHaveBeenCalledWith(validParams.stripeSubscriptionId);
      expect(subscriptionRepository.findByStripeSubscriptionId).toHaveBeenCalledWith({
        stripeSubscriptionId: validParams.stripeSubscriptionId,
      });
      expect(subscriptionRepository.updateByStripeSubscriptionId).toHaveBeenCalled();
    });

    it("should not update when subscription does not exist in database", async () => {
      stripeSubscriptionApiService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(null);

      await service.syncSubscriptionFromStripe(validParams);

      expect(stripeSubscriptionApiService.retrieveSubscription).toHaveBeenCalledWith(validParams.stripeSubscriptionId);
      expect(subscriptionRepository.findByStripeSubscriptionId).toHaveBeenCalledWith({
        stripeSubscriptionId: validParams.stripeSubscriptionId,
      });
      expect(subscriptionRepository.updateByStripeSubscriptionId).not.toHaveBeenCalled();
    });

    it("should convert Unix timestamps to Date objects (multiply by 1000)", async () => {
      stripeSubscriptionApiService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
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
      stripeSubscriptionApiService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
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
      stripeSubscriptionApiService.retrieveSubscription.mockResolvedValue(subscriptionWithCanceledAt);
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
      stripeSubscriptionApiService.retrieveSubscription.mockResolvedValue(subscriptionWithTrial);
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
      stripeSubscriptionApiService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
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
      stripeSubscriptionApiService.retrieveSubscription.mockResolvedValue(mockStripeSubscriptionForSync);
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
        discount: null,
      });
    });

    it("should store the discount the Stripe subscription carries", async () => {
      const withDiscount = {
        ...mockStripeSubscriptionForSync,
        discounts: [
          {
            id: "di_1",
            object: "discount",
            end: null,
            source: {
              type: "coupon",
              coupon: { id: "co_1", percent_off: 20, amount_off: null, currency: null, duration: "forever" },
            },
          },
        ],
      } as unknown as Stripe.Subscription;
      stripeSubscriptionApiService.retrieveSubscription.mockResolvedValue(withDiscount);
      subscriptionRepository.findByStripeSubscriptionId.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      subscriptionRepository.updateByStripeSubscriptionId.mockResolvedValue(undefined);

      await service.syncSubscriptionFromStripe(validParams);

      expect(subscriptionRepository.updateByStripeSubscriptionId).toHaveBeenCalledWith(
        expect.objectContaining({
          discount: {
            percentOff: 20,
            amountOff: null,
            currency: null,
            duration: "forever",
            durationInMonths: null,
            end: null,
          },
        }),
      );
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle concurrent requests for same subscription", async () => {
      const validParams = { id: MOCK_DB_SUBSCRIPTION.id, companyId: TEST_IDS.companyId };
      subscriptionRepository.findById.mockResolvedValue(MOCK_DB_SUBSCRIPTION);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

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
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(null);

      await expect(service.listSubscriptions(params)).rejects.toThrow(
        new HttpException("Stripe customer not found for this company", HttpStatus.NOT_FOUND),
      );
    });

    it("should preserve exact Stripe IDs in all operations", async () => {
      const exactStripeId = "sub_exact_test_123456";
      const subscription = { ...MOCK_DB_SUBSCRIPTION, stripeSubscriptionId: exactStripeId };
      const validParams = { id: subscription.id, companyId: TEST_IDS.companyId };

      subscriptionRepository.findById.mockResolvedValue(subscription);
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripeSubscriptionApiService.cancelSubscription.mockResolvedValue(MOCK_SUBSCRIPTION);
      subscriptionRepository.update.mockResolvedValue(subscription);
      jsonApiService.buildSingle.mockResolvedValue(MOCK_JSON_API_RESPONSE);

      await service.cancelSubscription(validParams);

      expect(stripeSubscriptionApiService.cancelSubscription).toHaveBeenCalledWith(exactStripeId, true);
    });

    it("should handle Stripe API errors gracefully", async () => {
      const validParams = {
        companyId: TEST_IDS.companyId,
        priceId: MOCK_STRIPE_PRICE.id,
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      const stripeError = new Error("Stripe API error");
      stripeSubscriptionApiService.createSubscription.mockRejectedValue(stripeError);

      await expect(service.createSubscription(validParams)).rejects.toThrow("Stripe API error");

      expect(subscriptionRepository.createSubscription).not.toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      const validParams = {
        companyId: TEST_IDS.companyId,
        priceId: MOCK_STRIPE_PRICE.id,
      };
      stripeCustomerRepository.findByCompanyId.mockResolvedValue(MOCK_STRIPE_CUSTOMER);
      stripePriceRepository.findById.mockResolvedValue(MOCK_STRIPE_PRICE);
      stripeSubscriptionApiService.createSubscription.mockResolvedValue({
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
      subscriptionRepository.createSubscription.mockRejectedValue(dbError);

      await expect(service.createSubscription(validParams)).rejects.toThrow("Database error");

      expect(stripeSubscriptionApiService.createSubscription).toHaveBeenCalled();
    });
  });
});
