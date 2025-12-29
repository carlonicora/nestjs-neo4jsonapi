import { Test, TestingModule } from "@nestjs/testing";
import { StripePaymentService } from "./stripe.payment.service";
import { StripeService } from "./stripe.service";
import { StripeError } from "../errors/stripe.errors";
import { createMockStripeClient, MockStripeClient } from "../__tests__/mocks/stripe.mock";
import {
  MOCK_PAYMENT_INTENT,
  MOCK_SETUP_INTENT,
  MOCK_PAYMENT_METHOD,
  TEST_IDS,
  STRIPE_CARD_ERROR,
  STRIPE_INVALID_REQUEST_ERROR,
  STRIPE_API_ERROR,
} from "../__tests__/fixtures/stripe.fixtures";

describe("StripePaymentService", () => {
  let service: StripePaymentService;
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
        StripePaymentService,
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    service = module.get<StripePaymentService>(StripePaymentService);
    stripeService = module.get(StripeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createPaymentIntent", () => {
    const validParams = {
      amount: 1000,
      currency: "usd",
      stripeCustomerId: TEST_IDS.customerId,
    };

    it("should create payment intent with required params", async () => {
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);

      const result = await service.createPaymentIntent(validParams);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: validParams.amount,
        currency: validParams.currency,
        customer: validParams.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: undefined,
        description: undefined,
        receipt_email: undefined,
      });
      expect(result).toEqual(MOCK_PAYMENT_INTENT);
    });

    it("should create payment intent with metadata", async () => {
      const paramsWithMetadata = {
        ...validParams,
        metadata: { orderId: "order_123", invoiceId: "inv_123" },
      };
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);

      await service.createPaymentIntent(paramsWithMetadata);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: validParams.amount,
        currency: validParams.currency,
        customer: validParams.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: "order_123", invoiceId: "inv_123" },
        description: undefined,
        receipt_email: undefined,
      });
    });

    it("should create payment intent with description", async () => {
      const paramsWithDescription = {
        ...validParams,
        description: "Payment for premium subscription",
      };
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);

      await service.createPaymentIntent(paramsWithDescription);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: validParams.amount,
        currency: validParams.currency,
        customer: validParams.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: undefined,
        description: "Payment for premium subscription",
        receipt_email: undefined,
      });
    });

    it("should create payment intent with receipt email", async () => {
      const paramsWithReceipt = {
        ...validParams,
        receiptEmail: "receipt@example.com",
      };
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);

      await service.createPaymentIntent(paramsWithReceipt);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: validParams.amount,
        currency: validParams.currency,
        customer: validParams.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: undefined,
        description: undefined,
        receipt_email: "receipt@example.com",
      });
    });

    it("should create payment intent with all optional params", async () => {
      const completeParams = {
        ...validParams,
        metadata: { orderId: "order_123" },
        description: "Complete payment",
        receiptEmail: "receipt@example.com",
      };
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);

      await service.createPaymentIntent(completeParams);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: validParams.amount,
        currency: validParams.currency,
        customer: validParams.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: "order_123" },
        description: "Complete payment",
        receipt_email: "receipt@example.com",
      });
    });

    it("should handle different currency codes", async () => {
      const eurParams = { ...validParams, currency: "eur" };
      mockStripe.paymentIntents.create.mockResolvedValue({
        ...MOCK_PAYMENT_INTENT,
        currency: "eur",
      });

      await service.createPaymentIntent(eurParams);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: "eur",
        }),
      );
    });

    it("should handle large amounts", async () => {
      const largeAmountParams = { ...validParams, amount: 999999999 };
      mockStripe.paymentIntents.create.mockResolvedValue({
        ...MOCK_PAYMENT_INTENT,
        amount: 999999999,
      });

      await service.createPaymentIntent(largeAmountParams);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 999999999,
        }),
      );
    });

    it("should handle Stripe card errors", async () => {
      mockStripe.paymentIntents.create.mockRejectedValue(STRIPE_CARD_ERROR);

      await expect(service.createPaymentIntent(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe invalid request errors", async () => {
      mockStripe.paymentIntents.create.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.createPaymentIntent(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.paymentIntents.create.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.createPaymentIntent(validParams)).rejects.toThrow(StripeError);
    });
  });

  describe("retrievePaymentIntent", () => {
    it("should retrieve payment intent successfully", async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValue(MOCK_PAYMENT_INTENT);

      const result = await service.retrievePaymentIntent(TEST_IDS.paymentIntentId);

      expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith(TEST_IDS.paymentIntentId);
      expect(result).toEqual(MOCK_PAYMENT_INTENT);
    });

    it("should retrieve payment intent with different statuses", async () => {
      const succeededIntent = { ...MOCK_PAYMENT_INTENT, status: "succeeded" };
      mockStripe.paymentIntents.retrieve.mockResolvedValue(succeededIntent as any);

      const result = await service.retrievePaymentIntent(TEST_IDS.paymentIntentId);

      expect(result.status).toBe("succeeded");
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.paymentIntents.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.retrievePaymentIntent(TEST_IDS.paymentIntentId)).rejects.toThrow(StripeError);
    });

    it("should handle invalid payment intent ID errors", async () => {
      mockStripe.paymentIntents.retrieve.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.retrievePaymentIntent("invalid_pi_id")).rejects.toThrow(StripeError);
    });
  });

  describe("confirmPaymentIntent", () => {
    it("should confirm payment intent with payment method", async () => {
      const confirmedIntent = { ...MOCK_PAYMENT_INTENT, status: "succeeded" };
      mockStripe.paymentIntents.confirm.mockResolvedValue(confirmedIntent as any);

      const result = await service.confirmPaymentIntent(TEST_IDS.paymentIntentId, TEST_IDS.paymentMethodId);

      expect(mockStripe.paymentIntents.confirm).toHaveBeenCalledWith(TEST_IDS.paymentIntentId, {
        payment_method: TEST_IDS.paymentMethodId,
      });
      expect(result).toEqual(confirmedIntent);
    });

    it("should handle confirmation with 3D Secure requirement", async () => {
      const requiresActionIntent = {
        ...MOCK_PAYMENT_INTENT,
        status: "requires_action",
        next_action: { type: "use_stripe_sdk" },
      };
      mockStripe.paymentIntents.confirm.mockResolvedValue(requiresActionIntent as any);

      const result = await service.confirmPaymentIntent(TEST_IDS.paymentIntentId, TEST_IDS.paymentMethodId);

      expect(result.status).toBe("requires_action");
      expect(result.next_action).toBeDefined();
    });

    it("should handle Stripe card errors during confirmation", async () => {
      mockStripe.paymentIntents.confirm.mockRejectedValue(STRIPE_CARD_ERROR);

      await expect(service.confirmPaymentIntent(TEST_IDS.paymentIntentId, TEST_IDS.paymentMethodId)).rejects.toThrow(
        StripeError,
      );
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.paymentIntents.confirm.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.confirmPaymentIntent(TEST_IDS.paymentIntentId, TEST_IDS.paymentMethodId)).rejects.toThrow(
        StripeError,
      );
    });
  });

  describe("cancelPaymentIntent", () => {
    it("should cancel payment intent successfully", async () => {
      const canceledIntent = { ...MOCK_PAYMENT_INTENT, status: "canceled" };
      mockStripe.paymentIntents.cancel.mockResolvedValue(canceledIntent as any);

      const result = await service.cancelPaymentIntent(TEST_IDS.paymentIntentId);

      expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith(TEST_IDS.paymentIntentId);
      expect(result).toEqual(canceledIntent);
    });

    it("should handle canceling already canceled payment intent", async () => {
      mockStripe.paymentIntents.cancel.mockRejectedValue({
        ...STRIPE_INVALID_REQUEST_ERROR,
        message: "You cannot cancel this PaymentIntent because it has a status of canceled",
      });

      await expect(service.cancelPaymentIntent(TEST_IDS.paymentIntentId)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.paymentIntents.cancel.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.cancelPaymentIntent(TEST_IDS.paymentIntentId)).rejects.toThrow(StripeError);
    });
  });

  describe("createSetupIntent", () => {
    const validParams = {
      stripeCustomerId: TEST_IDS.customerId,
    };

    it("should create setup intent with required params", async () => {
      mockStripe.setupIntents.create.mockResolvedValue(MOCK_SETUP_INTENT);

      const result = await service.createSetupIntent(validParams);

      expect(mockStripe.setupIntents.create).toHaveBeenCalledWith({
        customer: validParams.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: undefined,
        usage: "off_session",
      });
      expect(result).toEqual(MOCK_SETUP_INTENT);
    });

    it("should create setup intent with metadata", async () => {
      const paramsWithMetadata = {
        ...validParams,
        metadata: { source: "web", action: "add_payment_method" },
      };
      mockStripe.setupIntents.create.mockResolvedValue(MOCK_SETUP_INTENT);

      await service.createSetupIntent(paramsWithMetadata);

      expect(mockStripe.setupIntents.create).toHaveBeenCalledWith({
        customer: validParams.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: { source: "web", action: "add_payment_method" },
        usage: "off_session",
      });
    });

    it("should create setup intent with on_session usage", async () => {
      const paramsWithUsage = {
        ...validParams,
        usage: "on_session" as const,
      };
      mockStripe.setupIntents.create.mockResolvedValue({
        ...MOCK_SETUP_INTENT,
        usage: "on_session",
      });

      await service.createSetupIntent(paramsWithUsage);

      expect(mockStripe.setupIntents.create).toHaveBeenCalledWith({
        customer: validParams.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: undefined,
        usage: "on_session",
      });
    });

    it("should create setup intent with off_session usage (default)", async () => {
      mockStripe.setupIntents.create.mockResolvedValue(MOCK_SETUP_INTENT);

      await service.createSetupIntent(validParams);

      expect(mockStripe.setupIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: "off_session",
        }),
      );
    });

    it("should handle Stripe card errors", async () => {
      mockStripe.setupIntents.create.mockRejectedValue(STRIPE_CARD_ERROR);

      await expect(service.createSetupIntent(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.setupIntents.create.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.createSetupIntent(validParams)).rejects.toThrow(StripeError);
    });
  });

  describe("retrieveSetupIntent", () => {
    it("should retrieve setup intent successfully", async () => {
      mockStripe.setupIntents.retrieve.mockResolvedValue(MOCK_SETUP_INTENT);

      const result = await service.retrieveSetupIntent(TEST_IDS.setupIntentId);

      expect(mockStripe.setupIntents.retrieve).toHaveBeenCalledWith(TEST_IDS.setupIntentId);
      expect(result).toEqual(MOCK_SETUP_INTENT);
    });

    it("should retrieve setup intent with different statuses", async () => {
      const succeededIntent = { ...MOCK_SETUP_INTENT, status: "succeeded" };
      mockStripe.setupIntents.retrieve.mockResolvedValue(succeededIntent as any);

      const result = await service.retrieveSetupIntent(TEST_IDS.setupIntentId);

      expect(result.status).toBe("succeeded");
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.setupIntents.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.retrieveSetupIntent(TEST_IDS.setupIntentId)).rejects.toThrow(StripeError);
    });

    it("should handle invalid setup intent ID errors", async () => {
      mockStripe.setupIntents.retrieve.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.retrieveSetupIntent("invalid_seti_id")).rejects.toThrow(StripeError);
    });
  });

  describe("retrievePaymentMethod", () => {
    it("should retrieve payment method successfully", async () => {
      mockStripe.paymentMethods.retrieve.mockResolvedValue(MOCK_PAYMENT_METHOD);

      const result = await service.retrievePaymentMethod(TEST_IDS.paymentMethodId);

      expect(mockStripe.paymentMethods.retrieve).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(result).toEqual(MOCK_PAYMENT_METHOD);
    });

    it("should retrieve payment method with card details", async () => {
      mockStripe.paymentMethods.retrieve.mockResolvedValue(MOCK_PAYMENT_METHOD);

      const result = await service.retrievePaymentMethod(TEST_IDS.paymentMethodId);

      expect(result.type).toBe("card");
      expect(result.card).toBeDefined();
      expect(result.card?.last4).toBe("4242");
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.paymentMethods.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.retrievePaymentMethod(TEST_IDS.paymentMethodId)).rejects.toThrow(StripeError);
    });

    it("should handle invalid payment method ID errors", async () => {
      mockStripe.paymentMethods.retrieve.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.retrievePaymentMethod("invalid_pm_id")).rejects.toThrow(StripeError);
    });
  });

  describe("Edge Cases", () => {
    it("should handle payment intent with zero amount", async () => {
      const zeroAmountParams = {
        amount: 0,
        currency: "usd",
        stripeCustomerId: TEST_IDS.customerId,
      };
      mockStripe.paymentIntents.create.mockResolvedValue({
        ...MOCK_PAYMENT_INTENT,
        amount: 0,
      });

      const result = await service.createPaymentIntent(zeroAmountParams);

      expect(result.amount).toBe(0);
    });

    it("should handle payment intent with minimal amount", async () => {
      const minimalAmountParams = {
        amount: 1,
        currency: "usd",
        stripeCustomerId: TEST_IDS.customerId,
      };
      mockStripe.paymentIntents.create.mockResolvedValue({
        ...MOCK_PAYMENT_INTENT,
        amount: 1,
      });

      await service.createPaymentIntent(minimalAmountParams);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1,
        }),
      );
    });

    it("should handle setup intent without optional params", async () => {
      const minimalParams = {
        stripeCustomerId: TEST_IDS.customerId,
      };
      mockStripe.setupIntents.create.mockResolvedValue(MOCK_SETUP_INTENT);

      await service.createSetupIntent(minimalParams);

      expect(mockStripe.setupIntents.create).toHaveBeenCalledWith({
        customer: minimalParams.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: undefined,
        usage: "off_session",
      });
    });

    it("should handle empty metadata object", async () => {
      const paramsWithEmptyMetadata = {
        amount: 1000,
        currency: "usd",
        stripeCustomerId: TEST_IDS.customerId,
        metadata: {},
      };
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);

      await service.createPaymentIntent(paramsWithEmptyMetadata);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {},
        }),
      );
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact amount values", async () => {
      const exactParams = {
        amount: 12345,
        currency: "usd",
        stripeCustomerId: "cus_exact_test_123",
      };
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);

      await service.createPaymentIntent(exactParams);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 12345,
          currency: "usd",
          customer: "cus_exact_test_123",
        }),
      );
    });

    it("should preserve exact metadata values", async () => {
      const exactParams = {
        amount: 1000,
        currency: "usd",
        stripeCustomerId: TEST_IDS.customerId,
        metadata: {
          key1: "value1",
          key2: "value2",
          nested_key: "nested_value",
        },
      };
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);

      await service.createPaymentIntent(exactParams);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            key1: "value1",
            key2: "value2",
            nested_key: "nested_value",
          },
        }),
      );
    });

    it("should preserve exact string values in all parameters", async () => {
      const exactParams = {
        amount: 5000,
        currency: "gbp",
        stripeCustomerId: "cus_uk_test_456",
        description: "Exact description text",
        receiptEmail: "exact@receipt.com",
      };
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);

      await service.createPaymentIntent(exactParams);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: 5000,
        currency: "gbp",
        customer: "cus_uk_test_456",
        automatic_payment_methods: { enabled: true },
        metadata: undefined,
        description: "Exact description text",
        receipt_email: "exact@receipt.com",
      });
    });
  });

  describe("Service Integration", () => {
    it("should use StripeService to get client", async () => {
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);

      await service.createPaymentIntent({
        amount: 1000,
        currency: "usd",
        stripeCustomerId: TEST_IDS.customerId,
      });

      expect(stripeService.getClient).toHaveBeenCalled();
    });

    it("should call getClient before each operation", async () => {
      mockStripe.paymentIntents.create.mockResolvedValue(MOCK_PAYMENT_INTENT);
      mockStripe.paymentIntents.retrieve.mockResolvedValue(MOCK_PAYMENT_INTENT);
      mockStripe.paymentIntents.confirm.mockResolvedValue(MOCK_PAYMENT_INTENT);
      mockStripe.paymentIntents.cancel.mockResolvedValue(MOCK_PAYMENT_INTENT);
      mockStripe.setupIntents.create.mockResolvedValue(MOCK_SETUP_INTENT);

      await service.createPaymentIntent({
        amount: 1000,
        currency: "usd",
        stripeCustomerId: TEST_IDS.customerId,
      });
      await service.retrievePaymentIntent(TEST_IDS.paymentIntentId);
      await service.confirmPaymentIntent(TEST_IDS.paymentIntentId, TEST_IDS.paymentMethodId);
      await service.cancelPaymentIntent(TEST_IDS.paymentIntentId);
      await service.createSetupIntent({ stripeCustomerId: TEST_IDS.customerId });

      expect(stripeService.getClient).toHaveBeenCalledTimes(5);
    });
  });
});
