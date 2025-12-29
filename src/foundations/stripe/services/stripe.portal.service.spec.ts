import { Test, TestingModule } from "@nestjs/testing";
import { StripePortalService } from "./stripe.portal.service";
import { StripeService } from "./stripe.service";
import { StripeError } from "../errors/stripe.errors";
import { createMockStripeClient, MockStripeClient } from "../__tests__/mocks/stripe.mock";
import {
  MOCK_PORTAL_SESSION,
  TEST_IDS,
  STRIPE_API_ERROR,
  STRIPE_INVALID_REQUEST_ERROR,
  STRIPE_AUTHENTICATION_ERROR,
  STRIPE_CONNECTION_ERROR,
} from "../__tests__/fixtures/stripe.fixtures";

describe("StripePortalService", () => {
  let service: StripePortalService;
  let stripeService: jest.Mocked<StripeService>;
  let mockStripe: MockStripeClient;

  const mockPortalReturnUrl = "https://example.com/billing";
  const mockConfigurationId = "bpc_test_12345678";

  beforeEach(async () => {
    mockStripe = createMockStripeClient();

    const mockStripeService = {
      getClient: jest.fn().mockReturnValue(mockStripe),
      isConfigured: jest.fn().mockReturnValue(true),
      getPortalReturnUrl: jest.fn().mockReturnValue(mockPortalReturnUrl),
      getPortalConfigurationId: jest.fn().mockReturnValue(mockConfigurationId),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripePortalService,
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    service = module.get<StripePortalService>(StripePortalService);
    stripeService = module.get(StripeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createPortalSession", () => {
    it("should create portal session with default return URL", async () => {
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      const result = await service.createPortalSession(TEST_IDS.customerId);

      expect(stripeService.getClient).toHaveBeenCalled();
      expect(stripeService.getPortalReturnUrl).toHaveBeenCalled();
      expect(stripeService.getPortalConfigurationId).toHaveBeenCalled();
      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        return_url: mockPortalReturnUrl,
        configuration: mockConfigurationId,
      });
      expect(result).toEqual(MOCK_PORTAL_SESSION);
    });

    it("should create portal session with custom return URL", async () => {
      const customReturnUrl = "https://custom.com/return";
      mockStripe.billingPortal.sessions.create.mockResolvedValue({
        ...MOCK_PORTAL_SESSION,
        return_url: customReturnUrl,
      });

      const result = await service.createPortalSession(TEST_IDS.customerId, customReturnUrl);

      expect(stripeService.getPortalReturnUrl).not.toHaveBeenCalled();
      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        return_url: customReturnUrl,
        configuration: mockConfigurationId,
      });
      expect(result.return_url).toBe(customReturnUrl);
    });

    it("should create portal session without configuration when not set", async () => {
      stripeService.getPortalConfigurationId = jest.fn().mockReturnValue(undefined);
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId);

      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        return_url: mockPortalReturnUrl,
      });
    });

    it("should create portal session without configuration when null", async () => {
      stripeService.getPortalConfigurationId = jest.fn().mockReturnValue(null as any);
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId);

      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        return_url: mockPortalReturnUrl,
      });
    });

    it("should create portal session without configuration when empty string", async () => {
      stripeService.getPortalConfigurationId = jest.fn().mockReturnValue("");
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId);

      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        return_url: mockPortalReturnUrl,
      });
    });

    it("should handle Stripe API errors", async () => {
      mockStripe.billingPortal.sessions.create.mockRejectedValue(STRIPE_API_ERROR);

      await expect(service.createPortalSession(TEST_IDS.customerId)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe invalid request errors", async () => {
      mockStripe.billingPortal.sessions.create.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      await expect(service.createPortalSession(TEST_IDS.customerId)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe authentication errors", async () => {
      mockStripe.billingPortal.sessions.create.mockRejectedValue(STRIPE_AUTHENTICATION_ERROR);

      await expect(service.createPortalSession(TEST_IDS.customerId)).rejects.toThrow(StripeError);
    });

    it("should handle Stripe connection errors", async () => {
      mockStripe.billingPortal.sessions.create.mockRejectedValue(STRIPE_CONNECTION_ERROR);

      await expect(service.createPortalSession(TEST_IDS.customerId)).rejects.toThrow(StripeError);
    });

    it("should handle invalid customer ID", async () => {
      const invalidCustomerError = {
        type: "StripeInvalidRequestError",
        message: "No such customer",
        code: "resource_missing",
        param: "customer",
      };
      mockStripe.billingPortal.sessions.create.mockRejectedValue(invalidCustomerError);

      await expect(service.createPortalSession("invalid_customer_id")).rejects.toThrow(StripeError);
    });

    it("should preserve exact customer ID in request", async () => {
      const exactCustomerId = "cus_exact_test_12345";
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(exactCustomerId);

      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: exactCustomerId,
        return_url: mockPortalReturnUrl,
        configuration: mockConfigurationId,
      });
    });

    it("should preserve exact return URL in request", async () => {
      const exactReturnUrl = "https://exact-domain.com/exact/path?param=value";
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId, exactReturnUrl);

      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        return_url: exactReturnUrl,
        configuration: mockConfigurationId,
      });
    });

    it("should return complete portal session object", async () => {
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      const result = await service.createPortalSession(TEST_IDS.customerId);

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("object", "billing_portal.session");
      expect(result).toHaveProperty("customer", TEST_IDS.customerId);
      expect(result).toHaveProperty("url");
      expect(result).toHaveProperty("return_url");
      expect(result).toHaveProperty("created");
    });

    it("should create portal session with various customer ID formats", async () => {
      const customerIds = ["cus_test_123", "cus_prod_456", "cus_live_789"];

      for (const customerId of customerIds) {
        mockStripe.billingPortal.sessions.create.mockResolvedValue({
          ...MOCK_PORTAL_SESSION,
          customer: customerId,
        });

        const result = await service.createPortalSession(customerId);

        expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
          customer: customerId,
          return_url: mockPortalReturnUrl,
          configuration: mockConfigurationId,
        });
        expect(result.customer).toBe(customerId);
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle concurrent portal session creation requests", async () => {
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      const promises = [
        service.createPortalSession(TEST_IDS.customerId),
        service.createPortalSession(TEST_IDS.customerId),
        service.createPortalSession(TEST_IDS.customerId),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledTimes(3);
      results.forEach((result) => {
        expect(result).toEqual(MOCK_PORTAL_SESSION);
      });
    });

    it("should handle very long return URLs", async () => {
      const longReturnUrl =
        "https://example.com/" +
        "very/".repeat(50) +
        "long/path?param1=value1&param2=value2&param3=value3&param4=value4";
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId, longReturnUrl);

      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        return_url: longReturnUrl,
        configuration: mockConfigurationId,
      });
    });

    it("should handle return URLs with special characters", async () => {
      const specialCharUrl = "https://example.com/return?redirect=/billing&success=true&utm_source=email";
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId, specialCharUrl);

      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        return_url: specialCharUrl,
        configuration: mockConfigurationId,
      });
    });
  });

  describe("Service Integration", () => {
    it("should use StripeService to get client", async () => {
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId);

      expect(stripeService.getClient).toHaveBeenCalledTimes(1);
    });

    it("should call getClient before each operation", async () => {
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId);
      await service.createPortalSession(TEST_IDS.customerId);
      await service.createPortalSession(TEST_IDS.customerId);

      expect(stripeService.getClient).toHaveBeenCalledTimes(3);
    });

    it("should use StripeService to get portal return URL when not provided", async () => {
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId);

      expect(stripeService.getPortalReturnUrl).toHaveBeenCalledTimes(1);
    });

    it("should use StripeService to get configuration ID", async () => {
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId);

      expect(stripeService.getPortalConfigurationId).toHaveBeenCalledTimes(1);
    });

    it("should not call getPortalReturnUrl when custom URL provided", async () => {
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId, "https://custom.com");

      expect(stripeService.getPortalReturnUrl).not.toHaveBeenCalled();
    });
  });

  describe("Error Scenarios", () => {
    it("should throw StripeError with proper status for API errors", async () => {
      mockStripe.billingPortal.sessions.create.mockRejectedValue(STRIPE_API_ERROR);

      try {
        await service.createPortalSession(TEST_IDS.customerId);
        fail("Should have thrown StripeError");
      } catch (error) {
        expect(error).toBeInstanceOf(StripeError);
        expect((error as StripeError).stripeCode).toBe(STRIPE_API_ERROR.code);
      }
    });

    it("should throw StripeError with proper status for invalid request errors", async () => {
      mockStripe.billingPortal.sessions.create.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);

      try {
        await service.createPortalSession(TEST_IDS.customerId);
        fail("Should have thrown StripeError");
      } catch (error) {
        expect(error).toBeInstanceOf(StripeError);
        expect((error as StripeError).stripeCode).toBe(STRIPE_INVALID_REQUEST_ERROR.code);
      }
    });

    it("should handle rate limit errors gracefully", async () => {
      const rateLimitError = {
        type: "StripeRateLimitError",
        message: "Too many requests",
        code: "rate_limit",
      };
      mockStripe.billingPortal.sessions.create.mockRejectedValue(rateLimitError);

      await expect(service.createPortalSession(TEST_IDS.customerId)).rejects.toThrow(StripeError);
    });

    it("should handle network timeout errors", async () => {
      const timeoutError = {
        type: "StripeConnectionError",
        message: "Request timeout",
        code: "connection_error",
      };
      mockStripe.billingPortal.sessions.create.mockRejectedValue(timeoutError);

      await expect(service.createPortalSession(TEST_IDS.customerId)).rejects.toThrow(StripeError);
    });
  });

  describe("Parameter Validation", () => {
    it("should create session with minimum required parameters", async () => {
      stripeService.getPortalConfigurationId = jest.fn().mockReturnValue(undefined);
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId);

      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        return_url: mockPortalReturnUrl,
      });
    });

    it("should create session with all optional parameters", async () => {
      const customReturnUrl = "https://custom.com/billing";
      mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

      await service.createPortalSession(TEST_IDS.customerId, customReturnUrl);

      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: TEST_IDS.customerId,
        return_url: customReturnUrl,
        configuration: mockConfigurationId,
      });
    });

    it("should handle different configuration ID formats", async () => {
      const configIds = ["bpc_test_123", "bpc_prod_456", "bpc_live_789"];

      for (const configId of configIds) {
        stripeService.getPortalConfigurationId = jest.fn().mockReturnValue(configId);
        mockStripe.billingPortal.sessions.create.mockResolvedValue(MOCK_PORTAL_SESSION);

        await service.createPortalSession(TEST_IDS.customerId);

        expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
          customer: TEST_IDS.customerId,
          return_url: mockPortalReturnUrl,
          configuration: configId,
        });
      }
    });
  });
});
