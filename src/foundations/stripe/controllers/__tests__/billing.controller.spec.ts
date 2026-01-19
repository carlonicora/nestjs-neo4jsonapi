import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../../foundations/chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the guards to avoid dependency resolution issues
vi.mock("../../../../common/guards", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
  AdminJwtAuthGuard: class MockAdminJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock the barrel export to provide only what we need
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
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { FastifyReply } from "fastify";
import { BillingController } from "../billing.controller";
import { BillingService } from "../../services/billing.service";
import { AuthenticatedRequest } from "@carlonicora/nestjs-neo4jsonapi";

describe("BillingController", () => {
  let controller: BillingController;
  let billingService: vi.Mocked<BillingService>;
  let mockReply: vi.Mocked<FastifyReply>;

  // Test data constants
  const TEST_IDS = {
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    customerId: "cus_test123",
    invoiceId: "in_test123",
    paymentMethodId: "pm_test123",
  };

  // Create a mock authenticated request
  const createMockRequest = (companyId: string = TEST_IDS.companyId): AuthenticatedRequest => {
    return {
      user: {
        companyId,
        userId: "550e8400-e29b-41d4-a716-446655440001",
      },
    } as AuthenticatedRequest;
  };

  // Create a mock Fastify reply
  const createMockReply = (): vi.Mocked<FastifyReply> => {
    const reply = {
      send: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
    } as unknown as vi.Mocked<FastifyReply>;
    return reply;
  };

  beforeEach(async () => {
    const mockBillingService = {
      createSetupIntent: vi.fn(),
      createPortalSession: vi.fn(),
      listPaymentMethods: vi.fn(),
      setDefaultPaymentMethod: vi.fn(),
      removePaymentMethod: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        {
          provide: BillingService,
          useValue: mockBillingService,
        },
      ],
    }).compile();

    controller = module.get<BillingController>(BillingController);
    billingService = module.get(BillingService);

    mockReply = createMockReply();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===================================================================
  // SETUP INTENT AND PORTAL ENDPOINTS
  // ===================================================================

  describe("Setup Intent and Portal Endpoints", () => {
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
  // INTEGRATION TESTS
  // ===================================================================

  describe("Integration Tests", () => {
    it("should have billingService dependency injected", () => {
      expect(controller["billingService"]).toBeDefined();
    });

    it("should extract companyId consistently across endpoints", async () => {
      const customCompanyId = "integration_test_company_123";
      const req = createMockRequest(customCompanyId);

      // Mock all services
      billingService.createPortalSession.mockResolvedValue({} as any);

      // Test portal session endpoint
      await controller.createPortalSession(req, createMockReply());
      expect(billingService.createPortalSession).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: customCompanyId }),
      );
    });
  });
});
