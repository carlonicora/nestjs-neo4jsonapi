import { Test, TestingModule } from "@nestjs/testing";
import { StripeCustomerService } from "./stripe.customer.service";
import { StripeService } from "./stripe.service";
import { StripeError } from "../errors/stripe.errors";
import { createMockStripeClient, MockStripeClient } from "../__tests__/mocks/stripe.mock";
import {
  MOCK_CUSTOMER,
  MOCK_DELETED_CUSTOMER,
  MOCK_PAYMENT_METHOD,
  TEST_IDS,
  STRIPE_CARD_ERROR,
  STRIPE_INVALID_REQUEST_ERROR,
  STRIPE_API_ERROR,
} from "../__tests__/fixtures/stripe.fixtures";

describe("StripeCustomerService", () => {
  let service: StripeCustomerService;
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
        StripeCustomerService,
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    service = module.get<StripeCustomerService>(StripeCustomerService);
    stripeService = module.get(StripeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createCustomer", () => {
    const validParams = {
      companyId: TEST_IDS.companyId,
      email: "test@example.com",
      name: "Test Customer",
    };

    it("should create customer with valid params", async () => {
      mockStripe.customers.create.mockResolvedValue(MOCK_CUSTOMER);

      const result = await service.createCustomer(validParams);

      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: validParams.email,
        name: validParams.name,
        metadata: { companyId: validParams.companyId },
      });
      expect(result).toEqual(MOCK_CUSTOMER);
    });

    it("should include additional metadata when provided", async () => {
      const paramsWithMetadata = {
        ...validParams,
        metadata: { source: "web", plan: "premium" },
      };
      mockStripe.customers.create.mockResolvedValue(MOCK_CUSTOMER);

      await service.createCustomer(paramsWithMetadata);

      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: validParams.email,
        name: validParams.name,
        metadata: {
          companyId: validParams.companyId,
          source: "web",
          plan: "premium",
        },
      });
    });

    it("should handle Stripe card errors", async () => {
      mockStripe.customers.create.mockRejectedValue(STRIPE_CARD_ERROR);

      await expect(service.createCustomer(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe invalid request errors", async () => {
      mockStripe.customers.create.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.createCustomer(validParams)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.customers.create.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.createCustomer(validParams)).rejects.toThrow(StripeError);
    });
  });

  describe("retrieveCustomer", () => {
    it("should retrieve customer successfully", async () => {
      mockStripe.customers.retrieve.mockResolvedValue(MOCK_CUSTOMER);

      const result = await service.retrieveCustomer(TEST_IDS.customerId);

      expect(mockStripe.customers.retrieve).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(result).toEqual(MOCK_CUSTOMER);
    });

    it("should throw error when customer has been deleted", async () => {
      mockStripe.customers.retrieve.mockResolvedValue(MOCK_DELETED_CUSTOMER);

      await expect(service.retrieveCustomer(TEST_IDS.customerId)).rejects.toThrow("Customer has been deleted");
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.customers.retrieve.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.retrieveCustomer(TEST_IDS.customerId)).rejects.toThrow(StripeError);
    });
  });

  describe("updateCustomer", () => {
    it("should update customer email", async () => {
      const params = {
        stripeCustomerId: TEST_IDS.customerId,
        email: "newemail@example.com",
      };
      mockStripe.customers.update.mockResolvedValue(MOCK_CUSTOMER);

      await service.updateCustomer(params);

      expect(mockStripe.customers.update).toHaveBeenCalledWith(TEST_IDS.customerId, {
        email: params.email,
      });
    });

    it("should update customer name", async () => {
      const params = {
        stripeCustomerId: TEST_IDS.customerId,
        name: "New Name",
      };
      mockStripe.customers.update.mockResolvedValue(MOCK_CUSTOMER);

      await service.updateCustomer(params);

      expect(mockStripe.customers.update).toHaveBeenCalledWith(TEST_IDS.customerId, {
        name: params.name,
      });
    });

    it("should update default payment method", async () => {
      const params = {
        stripeCustomerId: TEST_IDS.customerId,
        defaultPaymentMethodId: TEST_IDS.paymentMethodId,
      };
      mockStripe.customers.update.mockResolvedValue(MOCK_CUSTOMER);

      await service.updateCustomer(params);

      expect(mockStripe.customers.update).toHaveBeenCalledWith(TEST_IDS.customerId, {
        invoice_settings: {
          default_payment_method: TEST_IDS.paymentMethodId,
        },
      });
    });

    it("should update customer metadata", async () => {
      const params = {
        stripeCustomerId: TEST_IDS.customerId,
        metadata: { tier: "enterprise" },
      };
      mockStripe.customers.update.mockResolvedValue(MOCK_CUSTOMER);

      await service.updateCustomer(params);

      expect(mockStripe.customers.update).toHaveBeenCalledWith(TEST_IDS.customerId, {
        metadata: { tier: "enterprise" },
      });
    });

    it("should update multiple fields at once", async () => {
      const params = {
        stripeCustomerId: TEST_IDS.customerId,
        email: "new@example.com",
        name: "New Name",
        defaultPaymentMethodId: TEST_IDS.paymentMethodId,
        metadata: { tier: "premium" },
      };
      mockStripe.customers.update.mockResolvedValue(MOCK_CUSTOMER);

      await service.updateCustomer(params);

      expect(mockStripe.customers.update).toHaveBeenCalledWith(TEST_IDS.customerId, {
        email: params.email,
        name: params.name,
        invoice_settings: {
          default_payment_method: TEST_IDS.paymentMethodId,
        },
        metadata: { tier: "premium" },
      });
    });

    it("should handle Stripe API errors", async () => {
      const params = {
        stripeCustomerId: TEST_IDS.customerId,
        email: "new@example.com",
      };
      mockStripe.customers.update.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.updateCustomer(params)).rejects.toThrow(StripeError);
    });
  });

  describe("deleteCustomer", () => {
    it("should delete customer successfully", async () => {
      mockStripe.customers.del.mockResolvedValue(MOCK_DELETED_CUSTOMER);

      const result = await service.deleteCustomer(TEST_IDS.customerId);

      expect(mockStripe.customers.del).toHaveBeenCalledWith(TEST_IDS.customerId);
      expect(result).toEqual(MOCK_DELETED_CUSTOMER);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.customers.del.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.deleteCustomer(TEST_IDS.customerId)).rejects.toThrow(StripeError);
    });
  });

  describe("listPaymentMethods", () => {
    it("should list payment methods with default type (card)", async () => {
      mockStripe.paymentMethods.list.mockResolvedValue({
        object: "list",
        data: [MOCK_PAYMENT_METHOD],
        has_more: false,
        url: "/v1/payment_methods",
      });

      const result = await service.listPaymentMethods(TEST_IDS.customerId);

      expect(mockStripe.paymentMethods.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        type: "card",
      });
      expect(result).toEqual([MOCK_PAYMENT_METHOD]);
    });

    it("should list payment methods with custom type", async () => {
      mockStripe.paymentMethods.list.mockResolvedValue({
        object: "list",
        data: [MOCK_PAYMENT_METHOD],
        has_more: false,
        url: "/v1/payment_methods",
      });

      await service.listPaymentMethods(TEST_IDS.customerId, "sepa_debit");

      expect(mockStripe.paymentMethods.list).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        type: "sepa_debit",
      });
    });

    it("should return empty array when no payment methods", async () => {
      mockStripe.paymentMethods.list.mockResolvedValue({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/payment_methods",
      });

      const result = await service.listPaymentMethods(TEST_IDS.customerId);

      expect(result).toEqual([]);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.paymentMethods.list.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.listPaymentMethods(TEST_IDS.customerId)).rejects.toThrow(StripeError);
    });
  });

  describe("setDefaultPaymentMethod", () => {
    it("should set default payment method successfully", async () => {
      mockStripe.customers.update.mockResolvedValue(MOCK_CUSTOMER);

      const result = await service.setDefaultPaymentMethod(TEST_IDS.customerId, TEST_IDS.paymentMethodId);

      expect(mockStripe.customers.update).toHaveBeenCalledWith(TEST_IDS.customerId, {
        invoice_settings: {
          default_payment_method: TEST_IDS.paymentMethodId,
        },
      });
      expect(result).toEqual(MOCK_CUSTOMER);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.customers.update.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.setDefaultPaymentMethod(TEST_IDS.customerId, TEST_IDS.paymentMethodId)).rejects.toThrow(
        StripeError,
      );
    });
  });

  describe("detachPaymentMethod", () => {
    it("should detach payment method successfully", async () => {
      mockStripe.paymentMethods.detach.mockResolvedValue(MOCK_PAYMENT_METHOD);

      const result = await service.detachPaymentMethod(TEST_IDS.paymentMethodId);

      expect(mockStripe.paymentMethods.detach).toHaveBeenCalledWith(TEST_IDS.paymentMethodId);
      expect(result).toEqual(MOCK_PAYMENT_METHOD);
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.paymentMethods.detach.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.detachPaymentMethod(TEST_IDS.paymentMethodId)).rejects.toThrow(StripeError);
    });
  });

  describe("Edge Cases", () => {
    it("should handle customer with only required fields", async () => {
      const minimalParams = {
        companyId: TEST_IDS.companyId,
        email: "minimal@example.com",
        name: "Minimal",
      };
      mockStripe.customers.create.mockResolvedValue(MOCK_CUSTOMER);

      await service.createCustomer(minimalParams);

      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: minimalParams.email,
        name: minimalParams.name,
        metadata: { companyId: minimalParams.companyId },
      });
    });

    it("should handle update with only customer ID", async () => {
      const params = {
        stripeCustomerId: TEST_IDS.customerId,
      };
      mockStripe.customers.update.mockResolvedValue(MOCK_CUSTOMER);

      await service.updateCustomer(params);

      expect(mockStripe.customers.update).toHaveBeenCalledWith(TEST_IDS.customerId, {});
    });

    it("should handle empty payment methods list", async () => {
      mockStripe.paymentMethods.list.mockResolvedValue({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/payment_methods",
      });

      const result = await service.listPaymentMethods(TEST_IDS.customerId);

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("should handle multiple payment methods", async () => {
      const multipleMethods = [MOCK_PAYMENT_METHOD, { ...MOCK_PAYMENT_METHOD, id: "pm_test_second" }];
      mockStripe.paymentMethods.list.mockResolvedValue({
        object: "list",
        data: multipleMethods,
        has_more: false,
        url: "/v1/payment_methods",
      });

      const result = await service.listPaymentMethods(TEST_IDS.customerId);

      expect(result).toEqual(multipleMethods);
      expect(result.length).toBe(2);
    });
  });

  describe("Parameter Validation", () => {
    it("should preserve exact parameter values in create", async () => {
      const exactParams = {
        companyId: "exact_company_id_123",
        email: "exact@test.com",
        name: "Exact Name Test",
        metadata: { key1: "value1", key2: "value2" },
      };
      mockStripe.customers.create.mockResolvedValue(MOCK_CUSTOMER);

      await service.createCustomer(exactParams);

      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: exactParams.email,
        name: exactParams.name,
        metadata: {
          companyId: exactParams.companyId,
          key1: "value1",
          key2: "value2",
        },
      });
    });

    it("should preserve exact parameter values in update", async () => {
      const exactParams = {
        stripeCustomerId: "cus_exact_123",
        email: "exact@new.com",
        name: "Exact New Name",
        defaultPaymentMethodId: "pm_exact_123",
        metadata: { updated: "true" },
      };
      mockStripe.customers.update.mockResolvedValue(MOCK_CUSTOMER);

      await service.updateCustomer(exactParams);

      expect(mockStripe.customers.update).toHaveBeenCalledWith("cus_exact_123", {
        email: exactParams.email,
        name: exactParams.name,
        invoice_settings: {
          default_payment_method: exactParams.defaultPaymentMethodId,
        },
        metadata: { updated: "true" },
      });
    });
  });

  describe("Service Integration", () => {
    it("should use StripeService to get client", async () => {
      mockStripe.customers.create.mockResolvedValue(MOCK_CUSTOMER);

      await service.createCustomer({
        companyId: TEST_IDS.companyId,
        email: "test@example.com",
        name: "Test",
      });

      expect(stripeService.getClient).toHaveBeenCalled();
    });

    it("should call getClient before each operation", async () => {
      mockStripe.customers.retrieve.mockResolvedValue(MOCK_CUSTOMER);
      mockStripe.customers.update.mockResolvedValue(MOCK_CUSTOMER);
      mockStripe.customers.del.mockResolvedValue(MOCK_DELETED_CUSTOMER);

      await service.retrieveCustomer(TEST_IDS.customerId);
      await service.updateCustomer({ stripeCustomerId: TEST_IDS.customerId, email: "new@test.com" });
      await service.deleteCustomer(TEST_IDS.customerId);

      expect(stripeService.getClient).toHaveBeenCalledTimes(3);
    });
  });
});
