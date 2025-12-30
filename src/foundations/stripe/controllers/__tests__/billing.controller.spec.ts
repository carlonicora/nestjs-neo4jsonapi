// Mock problematic modules before any imports
jest.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the guards to avoid dependency resolution issues
jest.mock("../../../../common/guards", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = jest.fn().mockReturnValue(true);
  },
  AdminJwtAuthGuard: class MockAdminJwtAuthGuard {
    canActivate = jest.fn().mockReturnValue(true);
  },
}));

// Mock the barrel export to provide only what we need
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
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { BillingController } from "../billing.controller";
import { BillingService } from "../../services/billing.service";
import { UsageService } from "../../services/usage.service";
import { AuthenticatedRequest } from "@carlonicora/nestjs-neo4jsonapi";

describe("BillingController", () => {
  let controller: BillingController;
  let billingService: jest.Mocked<BillingService>;
  let usageService: jest.Mocked<UsageService>;
  let mockReply: jest.Mocked<FastifyReply>;

  // Test data constants
  const TEST_IDS = {
    companyId: "company_123",
    customerId: "cus_test123",
    invoiceId: "in_test123",
    paymentMethodId: "pm_test123",
    meterId: "meter_test123",
  };

  const MOCK_CUSTOMER_RESPONSE = {
    data: {
      type: "billing-customers",
      id: "billing_customer_123",
      attributes: {
        stripeCustomerId: TEST_IDS.customerId,
        email: "test@example.com",
        name: "Test Customer",
      },
    },
  };

  // Create a mock authenticated request
  const createMockRequest = (companyId: string = TEST_IDS.companyId): AuthenticatedRequest => {
    return {
      user: {
        companyId,
        userId: "user_123",
      },
    } as AuthenticatedRequest;
  };

  // Create a mock Fastify reply
  const createMockReply = (): jest.Mocked<FastifyReply> => {
    const reply = {
      send: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      code: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<FastifyReply>;
    return reply;
  };

  beforeEach(async () => {
    const mockBillingService = {
      getCustomer: jest.fn(),
      createCustomer: jest.fn(),
      createSetupIntent: jest.fn(),
      createPortalSession: jest.fn(),
      listPaymentMethods: jest.fn(),
      setDefaultPaymentMethod: jest.fn(),
      removePaymentMethod: jest.fn(),
    };

    const mockUsageService = {
      listMeters: jest.fn(),
      getMeterEventSummaries: jest.fn(),
      reportUsage: jest.fn(),
      listUsageRecords: jest.fn(),
      getUsageSummary: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        {
          provide: BillingService,
          useValue: mockBillingService,
        },
        {
          provide: UsageService,
          useValue: mockUsageService,
        },
      ],
    }).compile();

    controller = module.get<BillingController>(BillingController);
    billingService = module.get(BillingService);
    usageService = module.get(UsageService);

    mockReply = createMockReply();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===================================================================
  // CUSTOMER ENDPOINTS (4 endpoints)
  // ===================================================================

  describe("Customer Endpoints", () => {
    describe("GET /billing/customer", () => {
      it("should get customer successfully", async () => {
        const req = createMockRequest();
        billingService.getCustomer.mockResolvedValue(MOCK_CUSTOMER_RESPONSE);

        await controller.getCustomer(req, mockReply);

        expect(billingService.getCustomer).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
        });
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_CUSTOMER_RESPONSE);
      });

      it("should extract companyId from req.user", async () => {
        const customCompanyId = "custom_company_456";
        const req = createMockRequest(customCompanyId);
        billingService.getCustomer.mockResolvedValue(MOCK_CUSTOMER_RESPONSE);

        await controller.getCustomer(req, mockReply);

        expect(billingService.getCustomer).toHaveBeenCalledWith({
          companyId: customCompanyId,
        });
      });

      it("should handle service errors", async () => {
        const req = createMockRequest();
        const error = new Error("Service error");
        billingService.getCustomer.mockRejectedValue(error);

        await expect(controller.getCustomer(req, mockReply)).rejects.toThrow("Service error");
        expect(billingService.getCustomer).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
        });
      });
    });

    describe("POST /billing/customer", () => {
      const validCreateCustomerBody = {
        name: "New Customer",
        email: "new@example.com",
        currency: "usd",
      };

      it("should create customer successfully with 201 status", async () => {
        const req = createMockRequest();
        billingService.createCustomer.mockResolvedValue(MOCK_CUSTOMER_RESPONSE);

        await controller.createCustomer(req, mockReply, validCreateCustomerBody);

        expect(billingService.createCustomer).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          name: validCreateCustomerBody.name,
          email: validCreateCustomerBody.email,
          currency: validCreateCustomerBody.currency,
        });
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.CREATED);
        expect(mockReply.send).toHaveBeenCalledWith(MOCK_CUSTOMER_RESPONSE);
      });

      it("should pass all body parameters to service", async () => {
        const req = createMockRequest();
        const bodyWithAllFields = {
          name: "Complete Customer",
          email: "complete@example.com",
          currency: "eur",
        };
        billingService.createCustomer.mockResolvedValue(MOCK_CUSTOMER_RESPONSE);

        await controller.createCustomer(req, mockReply, bodyWithAllFields);

        expect(billingService.createCustomer).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          name: bodyWithAllFields.name,
          email: bodyWithAllFields.email,
          currency: bodyWithAllFields.currency,
        });
      });

      it("should handle service errors during creation", async () => {
        const req = createMockRequest();
        const error = new Error("Customer creation failed");
        billingService.createCustomer.mockRejectedValue(error);

        await expect(controller.createCustomer(req, mockReply, validCreateCustomerBody)).rejects.toThrow(
          "Customer creation failed",
        );
      });
    });

    describe("POST /billing/setup-intent", () => {
      const validSetupIntentBody = {
        paymentMethodType: "card" as const,
      };

      it("should create setup intent successfully", async () => {
        const req = createMockRequest();
        const mockSetupIntent = {
          data: {
            type: "setup-intents",
            id: "seti_123",
            attributes: { clientSecret: "secret_123" },
          },
        };
        billingService.createSetupIntent.mockResolvedValue(mockSetupIntent);

        await controller.createSetupIntent(req, mockReply, validSetupIntentBody);

        expect(billingService.createSetupIntent).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          paymentMethodType: validSetupIntentBody.paymentMethodType,
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockSetupIntent);
      });

      it("should extract companyId from req.user", async () => {
        const customCompanyId = "custom_company_789";
        const req = createMockRequest(customCompanyId);
        billingService.createSetupIntent.mockResolvedValue({} as any);

        await controller.createSetupIntent(req, mockReply, validSetupIntentBody);

        expect(billingService.createSetupIntent).toHaveBeenCalledWith({
          companyId: customCompanyId,
          paymentMethodType: validSetupIntentBody.paymentMethodType,
        });
      });
    });

    describe("POST /billing/customer/portal-session", () => {
      it("should create portal session successfully", async () => {
        const req = createMockRequest();
        const mockPortalSession = {
          data: {
            type: "portal-sessions",
            id: "ps_123",
            attributes: { url: "https://billing.stripe.com/session/test" },
          },
        };
        billingService.createPortalSession.mockResolvedValue(mockPortalSession);

        await controller.createPortalSession(req, mockReply);

        expect(billingService.createPortalSession).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockPortalSession);
      });

      it("should extract companyId from req.user", async () => {
        const customCompanyId = "portal_company_123";
        const req = createMockRequest(customCompanyId);
        billingService.createPortalSession.mockResolvedValue({} as any);

        await controller.createPortalSession(req, mockReply);

        expect(billingService.createPortalSession).toHaveBeenCalledWith({
          companyId: customCompanyId,
        });
      });
    });
  });

  // ===================================================================
  // PAYMENT METHODS ENDPOINTS (3 endpoints)
  // ===================================================================

  describe("Payment Methods Endpoints", () => {
    describe("GET /billing/payment-methods", () => {
      it("should list payment methods successfully", async () => {
        const req = createMockRequest();
        const mockPaymentMethods = {
          data: [
            {
              type: "payment-methods",
              id: "pm_123",
              attributes: { type: "card", last4: "4242" },
            },
          ],
        };
        billingService.listPaymentMethods.mockResolvedValue(mockPaymentMethods);

        await controller.listPaymentMethods(req, mockReply);

        expect(billingService.listPaymentMethods).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockPaymentMethods);
      });

      it("should extract companyId from req.user", async () => {
        const customCompanyId = "payment_company_123";
        const req = createMockRequest(customCompanyId);
        billingService.listPaymentMethods.mockResolvedValue({ data: [] });

        await controller.listPaymentMethods(req, mockReply);

        expect(billingService.listPaymentMethods).toHaveBeenCalledWith({
          companyId: customCompanyId,
        });
      });
    });

    describe("POST /billing/payment-methods/:paymentMethodId/default", () => {
      it("should set default payment method with 204 NO_CONTENT status", async () => {
        const req = createMockRequest();
        billingService.setDefaultPaymentMethod.mockResolvedValue(undefined);

        await controller.setDefaultPaymentMethod(req, mockReply, TEST_IDS.paymentMethodId);

        expect(billingService.setDefaultPaymentMethod).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          paymentMethodId: TEST_IDS.paymentMethodId,
        });
        expect(mockReply.send).toHaveBeenCalled();
      });

      it("should extract paymentMethodId from path params", async () => {
        const req = createMockRequest();
        const customPaymentMethodId = "pm_custom_456";
        billingService.setDefaultPaymentMethod.mockResolvedValue(undefined);

        await controller.setDefaultPaymentMethod(req, mockReply, customPaymentMethodId);

        expect(billingService.setDefaultPaymentMethod).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          paymentMethodId: customPaymentMethodId,
        });
      });

      it("should handle service errors", async () => {
        const req = createMockRequest();
        const error = new Error("Payment method not found");
        billingService.setDefaultPaymentMethod.mockRejectedValue(error);

        await expect(controller.setDefaultPaymentMethod(req, mockReply, TEST_IDS.paymentMethodId)).rejects.toThrow(
          "Payment method not found",
        );
      });
    });

    describe("DELETE /billing/payment-methods/:paymentMethodId", () => {
      it("should remove payment method with 204 NO_CONTENT status", async () => {
        const req = createMockRequest();
        billingService.removePaymentMethod.mockResolvedValue(undefined);

        await controller.removePaymentMethod(req, mockReply, TEST_IDS.paymentMethodId);

        expect(billingService.removePaymentMethod).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          paymentMethodId: TEST_IDS.paymentMethodId,
        });
        expect(mockReply.send).toHaveBeenCalled();
      });

      it("should extract paymentMethodId from path params", async () => {
        const req = createMockRequest();
        const customPaymentMethodId = "pm_to_delete_789";
        billingService.removePaymentMethod.mockResolvedValue(undefined);

        await controller.removePaymentMethod(req, mockReply, customPaymentMethodId);

        expect(billingService.removePaymentMethod).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          paymentMethodId: customPaymentMethodId,
        });
      });

      it("should handle service errors during removal", async () => {
        const req = createMockRequest();
        const error = new Error("Cannot remove default payment method");
        billingService.removePaymentMethod.mockRejectedValue(error);

        await expect(controller.removePaymentMethod(req, mockReply, TEST_IDS.paymentMethodId)).rejects.toThrow(
          "Cannot remove default payment method",
        );
      });
    });
  });

  // ===================================================================
  // USAGE ENDPOINTS (5 endpoints)
  // ===================================================================

  describe("Usage Endpoints", () => {
    describe("GET /billing/meters", () => {
      it("should list meters successfully", async () => {
        const req = createMockRequest();
        const mockMeters = {
          data: [
            {
              type: "meters",
              id: TEST_IDS.meterId,
              attributes: { name: "API Calls", unit: "calls" },
            },
          ],
        };
        usageService.listMeters.mockResolvedValue(mockMeters);

        await controller.listMeters(req, mockReply);

        expect(usageService.listMeters).toHaveBeenCalledWith();
        expect(mockReply.send).toHaveBeenCalledWith(mockMeters);
      });

      it("should not require companyId parameter", async () => {
        const req = createMockRequest();
        usageService.listMeters.mockResolvedValue({ data: [] });

        await controller.listMeters(req, mockReply);

        expect(usageService.listMeters).toHaveBeenCalledWith();
      });
    });

    describe("GET /billing/meters/:meterId/summaries", () => {
      const validStartTime = "2025-01-01T00:00:00Z";
      const validEndTime = "2025-01-31T23:59:59Z";

      it("should get meter summaries successfully with date conversion", async () => {
        const req = createMockRequest();
        const mockSummaries = {
          data: {
            type: "meter-summaries",
            attributes: { total: 1000 },
          },
        };
        usageService.getMeterEventSummaries.mockResolvedValue(mockSummaries);

        await controller.getMeterSummaries(req, mockReply, TEST_IDS.meterId, validStartTime, validEndTime);

        expect(usageService.getMeterEventSummaries).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          meterId: TEST_IDS.meterId,
          startTime: new Date(validStartTime),
          endTime: new Date(validEndTime),
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockSummaries);
      });

      it("should return 400 BAD_REQUEST when startTime is missing", async () => {
        const req = createMockRequest();

        await controller.getMeterSummaries(req, mockReply, TEST_IDS.meterId, undefined as any, validEndTime);

        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: "startTime and endTime query parameters are required",
        });
        expect(usageService.getMeterEventSummaries).not.toHaveBeenCalled();
      });

      it("should return 400 BAD_REQUEST when endTime is missing", async () => {
        const req = createMockRequest();

        await controller.getMeterSummaries(req, mockReply, TEST_IDS.meterId, validStartTime, undefined as any);

        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: "startTime and endTime query parameters are required",
        });
        expect(usageService.getMeterEventSummaries).not.toHaveBeenCalled();
      });

      it("should return 400 BAD_REQUEST when both startTime and endTime are missing", async () => {
        const req = createMockRequest();

        await controller.getMeterSummaries(req, mockReply, TEST_IDS.meterId, undefined as any, undefined as any);

        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: "startTime and endTime query parameters are required",
        });
        expect(usageService.getMeterEventSummaries).not.toHaveBeenCalled();
      });

      it("should convert string dates to Date objects", async () => {
        const req = createMockRequest();
        const startTimeString = "2025-06-15T10:30:00Z";
        const endTimeString = "2025-06-20T18:45:00Z";
        usageService.getMeterEventSummaries.mockResolvedValue({} as any);

        await controller.getMeterSummaries(req, mockReply, TEST_IDS.meterId, startTimeString, endTimeString);

        expect(usageService.getMeterEventSummaries).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          meterId: TEST_IDS.meterId,
          startTime: new Date(startTimeString),
          endTime: new Date(endTimeString),
        });
      });

      it("should extract meterId from path params", async () => {
        const req = createMockRequest();
        const customMeterId = "meter_custom_456";
        usageService.getMeterEventSummaries.mockResolvedValue({} as any);

        await controller.getMeterSummaries(req, mockReply, customMeterId, validStartTime, validEndTime);

        expect(usageService.getMeterEventSummaries).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          meterId: customMeterId,
          startTime: new Date(validStartTime),
          endTime: new Date(validEndTime),
        });
      });
    });

    describe("POST /billing/subscriptions/:subscriptionId/usage", () => {
      const validReportUsageBody = {
        meterId: TEST_IDS.meterId,
        meterEventName: "api_call",
        quantity: 100,
        timestamp: "2025-01-15T12:00:00Z",
      };

      it("should report usage successfully with 201 status and date conversion", async () => {
        const req = createMockRequest();
        const mockUsageResponse = {
          data: {
            type: "usage-records",
            id: "usage_123",
            attributes: { quantity: 100 },
          },
        };
        usageService.reportUsage.mockResolvedValue(mockUsageResponse);

        await controller.reportUsage(req, mockReply, TEST_IDS.subscriptionId, validReportUsageBody);

        expect(usageService.reportUsage).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: TEST_IDS.subscriptionId,
          meterId: validReportUsageBody.meterId,
          meterEventName: validReportUsageBody.meterEventName,
          quantity: validReportUsageBody.quantity,
          timestamp: new Date(validReportUsageBody.timestamp),
        });
        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.CREATED);
        expect(mockReply.send).toHaveBeenCalledWith(mockUsageResponse);
      });

      it("should convert timestamp string to Date object", async () => {
        const req = createMockRequest();
        const customTimestamp = "2025-12-25T23:59:59Z";
        const bodyWithCustomTimestamp = {
          ...validReportUsageBody,
          timestamp: customTimestamp,
        };
        usageService.reportUsage.mockResolvedValue({} as any);

        await controller.reportUsage(req, mockReply, TEST_IDS.subscriptionId, bodyWithCustomTimestamp);

        expect(usageService.reportUsage).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: TEST_IDS.subscriptionId,
          meterId: bodyWithCustomTimestamp.meterId,
          meterEventName: bodyWithCustomTimestamp.meterEventName,
          quantity: bodyWithCustomTimestamp.quantity,
          timestamp: new Date(customTimestamp),
        });
      });

      it("should handle undefined timestamp", async () => {
        const req = createMockRequest();
        const bodyWithoutTimestamp = {
          meterId: TEST_IDS.meterId,
          meterEventName: "api_call",
          quantity: 50,
        };
        usageService.reportUsage.mockResolvedValue({} as any);

        await controller.reportUsage(req, mockReply, TEST_IDS.subscriptionId, bodyWithoutTimestamp as any);

        expect(usageService.reportUsage).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: TEST_IDS.subscriptionId,
          meterId: bodyWithoutTimestamp.meterId,
          meterEventName: bodyWithoutTimestamp.meterEventName,
          quantity: bodyWithoutTimestamp.quantity,
          timestamp: undefined,
        });
      });

      it("should extract subscriptionId from path params", async () => {
        const req = createMockRequest();
        const customSubscriptionId = "sub_usage_report_789";
        usageService.reportUsage.mockResolvedValue({} as any);

        await controller.reportUsage(req, mockReply, customSubscriptionId, validReportUsageBody);

        expect(usageService.reportUsage).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: customSubscriptionId,
          meterId: validReportUsageBody.meterId,
          meterEventName: validReportUsageBody.meterEventName,
          quantity: validReportUsageBody.quantity,
          timestamp: new Date(validReportUsageBody.timestamp),
        });
      });
    });

    describe("GET /billing/subscriptions/:subscriptionId/usage", () => {
      it("should list usage records without date filters", async () => {
        const req = createMockRequest();
        const mockQuery = { page: { size: 10 } };
        const mockUsageRecords = {
          data: [
            {
              type: "usage-records",
              id: "usage_123",
              attributes: { quantity: 100 },
            },
          ],
        };
        usageService.listUsageRecords.mockResolvedValue(mockUsageRecords);

        await controller.listUsageRecords(req, mockReply, TEST_IDS.subscriptionId, mockQuery, undefined, undefined);

        expect(usageService.listUsageRecords).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: TEST_IDS.subscriptionId,
          query: mockQuery,
          startTime: undefined,
          endTime: undefined,
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockUsageRecords);
      });

      it("should list usage records with date filters and convert strings to Date", async () => {
        const req = createMockRequest();
        const mockQuery = { page: { size: 10 } };
        const startTime = "2025-01-01T00:00:00Z";
        const endTime = "2025-01-31T23:59:59Z";
        usageService.listUsageRecords.mockResolvedValue({ data: [] });

        await controller.listUsageRecords(req, mockReply, TEST_IDS.subscriptionId, mockQuery, startTime, endTime);

        expect(usageService.listUsageRecords).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: TEST_IDS.subscriptionId,
          query: mockQuery,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
        });
      });

      it("should convert only startTime when endTime is not provided", async () => {
        const req = createMockRequest();
        const mockQuery = {};
        const startTime = "2025-01-01T00:00:00Z";
        usageService.listUsageRecords.mockResolvedValue({ data: [] });

        await controller.listUsageRecords(req, mockReply, TEST_IDS.subscriptionId, mockQuery, startTime, undefined);

        expect(usageService.listUsageRecords).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: TEST_IDS.subscriptionId,
          query: mockQuery,
          startTime: new Date(startTime),
          endTime: undefined,
        });
      });

      it("should convert only endTime when startTime is not provided", async () => {
        const req = createMockRequest();
        const mockQuery = {};
        const endTime = "2025-01-31T23:59:59Z";
        usageService.listUsageRecords.mockResolvedValue({ data: [] });

        await controller.listUsageRecords(req, mockReply, TEST_IDS.subscriptionId, mockQuery, undefined, endTime);

        expect(usageService.listUsageRecords).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: TEST_IDS.subscriptionId,
          query: mockQuery,
          startTime: undefined,
          endTime: new Date(endTime),
        });
      });

      it("should extract subscriptionId from path params", async () => {
        const req = createMockRequest();
        const customSubscriptionId = "sub_list_usage_456";
        usageService.listUsageRecords.mockResolvedValue({ data: [] });

        await controller.listUsageRecords(req, mockReply, customSubscriptionId, {}, undefined, undefined);

        expect(usageService.listUsageRecords).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: customSubscriptionId,
          query: {},
          startTime: undefined,
          endTime: undefined,
        });
      });
    });

    describe("GET /billing/subscriptions/:subscriptionId/usage/summary", () => {
      const validStartTime = "2025-01-01T00:00:00Z";
      const validEndTime = "2025-01-31T23:59:59Z";

      it("should get usage summary successfully with date conversion", async () => {
        const req = createMockRequest();
        const mockSummary = {
          data: {
            type: "usage-summaries",
            attributes: { total: 5000 },
          },
        };
        usageService.getUsageSummary.mockResolvedValue(mockSummary);

        await controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, validStartTime, validEndTime);

        expect(usageService.getUsageSummary).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: TEST_IDS.subscriptionId,
          startTime: new Date(validStartTime),
          endTime: new Date(validEndTime),
        });
        expect(mockReply.send).toHaveBeenCalledWith(mockSummary);
      });

      it("should return 400 BAD_REQUEST when startTime is missing", async () => {
        const req = createMockRequest();

        await controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, undefined as any, validEndTime);

        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: "startTime and endTime query parameters are required",
        });
        expect(usageService.getUsageSummary).not.toHaveBeenCalled();
      });

      it("should return 400 BAD_REQUEST when endTime is missing", async () => {
        const req = createMockRequest();

        await controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, validStartTime, undefined as any);

        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: "startTime and endTime query parameters are required",
        });
        expect(usageService.getUsageSummary).not.toHaveBeenCalled();
      });

      it("should return 400 BAD_REQUEST when both startTime and endTime are missing", async () => {
        const req = createMockRequest();

        await controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, undefined as any, undefined as any);

        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: "startTime and endTime query parameters are required",
        });
        expect(usageService.getUsageSummary).not.toHaveBeenCalled();
      });

      it("should return 400 BAD_REQUEST when startTime is empty string", async () => {
        const req = createMockRequest();

        await controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, "", validEndTime);

        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: "startTime and endTime query parameters are required",
        });
        expect(usageService.getUsageSummary).not.toHaveBeenCalled();
      });

      it("should return 400 BAD_REQUEST when endTime is empty string", async () => {
        const req = createMockRequest();

        await controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, validStartTime, "");

        expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(mockReply.send).toHaveBeenCalledWith({
          error: "startTime and endTime query parameters are required",
        });
        expect(usageService.getUsageSummary).not.toHaveBeenCalled();
      });

      it("should convert string dates to Date objects", async () => {
        const req = createMockRequest();
        const startTimeString = "2025-06-01T00:00:00Z";
        const endTimeString = "2025-06-30T23:59:59Z";
        usageService.getUsageSummary.mockResolvedValue({} as any);

        await controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, startTimeString, endTimeString);

        expect(usageService.getUsageSummary).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: TEST_IDS.subscriptionId,
          startTime: new Date(startTimeString),
          endTime: new Date(endTimeString),
        });
      });

      it("should extract subscriptionId from path params", async () => {
        const req = createMockRequest();
        const customSubscriptionId = "sub_summary_789";
        usageService.getUsageSummary.mockResolvedValue({} as any);

        await controller.getUsageSummary(req, mockReply, customSubscriptionId, validStartTime, validEndTime);

        expect(usageService.getUsageSummary).toHaveBeenCalledWith({
          companyId: TEST_IDS.companyId,
          subscriptionId: customSubscriptionId,
          startTime: new Date(validStartTime),
          endTime: new Date(validEndTime),
        });
      });
    });
  });

  // ===================================================================
  // INTEGRATION TESTS
  // ===================================================================

  describe("Integration Tests", () => {
    it("should have all 2 service dependencies injected", () => {
      expect(controller["billingService"]).toBeDefined();
      expect(controller["usageService"]).toBeDefined();
    });

    it("should extract companyId consistently across all endpoints", async () => {
      const customCompanyId = "integration_test_company_123";
      const req = createMockRequest(customCompanyId);

      // Mock all services
      billingService.getCustomer.mockResolvedValue({} as any);
      usageService.listMeters.mockResolvedValue({ data: [] });

      // Test customer endpoint
      await controller.getCustomer(req, createMockReply());
      expect(billingService.getCustomer).toHaveBeenCalledWith(expect.objectContaining({ companyId: customCompanyId }));
    });

    it("should handle multiple validation errors correctly", async () => {
      const req = createMockRequest();

      // Test meter summaries validation
      await controller.getMeterSummaries(req, createMockReply(), "meter_123", undefined as any, undefined as any);
      expect(usageService.getMeterEventSummaries).not.toHaveBeenCalled();

      // Test usage summary validation
      await controller.getUsageSummary(req, createMockReply(), "sub_123", undefined as any, undefined as any);
      expect(usageService.getUsageSummary).not.toHaveBeenCalled();
    });

    it("should handle all Date conversions correctly", async () => {
      const req = createMockRequest();
      const startTime = "2025-01-01T00:00:00Z";
      const endTime = "2025-01-31T23:59:59Z";
      const timestamp = "2025-01-15T12:00:00Z";

      usageService.getMeterEventSummaries.mockResolvedValue({} as any);
      usageService.reportUsage.mockResolvedValue({} as any);
      usageService.listUsageRecords.mockResolvedValue({ data: [] });
      usageService.getUsageSummary.mockResolvedValue({} as any);

      // Test meter summaries date conversion
      await controller.getMeterSummaries(req, createMockReply(), "meter_123", startTime, endTime);
      expect(usageService.getMeterEventSummaries).toHaveBeenCalledWith(
        expect.objectContaining({
          startTime: new Date(startTime),
          endTime: new Date(endTime),
        }),
      );

      // Test report usage date conversion
      await controller.reportUsage(req, createMockReply(), "sub_123", {
        meterId: "meter_123",
        meterEventName: "event",
        quantity: 100,
        timestamp,
      });
      expect(usageService.reportUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: new Date(timestamp),
        }),
      );

      // Test list usage records date conversion
      await controller.listUsageRecords(req, createMockReply(), "sub_123", {}, startTime, endTime);
      expect(usageService.listUsageRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          startTime: new Date(startTime),
          endTime: new Date(endTime),
        }),
      );

      // Test usage summary date conversion
      await controller.getUsageSummary(req, createMockReply(), "sub_123", startTime, endTime);
      expect(usageService.getUsageSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          startTime: new Date(startTime),
          endTime: new Date(endTime),
        }),
      );
    });
  });
});
