// Mock problematic modules before any imports
jest.mock("../../../chunker/chunker.module", () => ({
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
import { StripeSubscriptionController } from "../stripe-subscription.controller";
import { StripeSubscriptionAdminService } from "../../services/stripe-subscription-admin.service";
import { AuthenticatedRequest } from "@carlonicora/nestjs-neo4jsonapi";
import type { StripeSubscriptionStatus } from "../../entities/stripe-subscription.entity";

describe("StripeSubscriptionController", () => {
  let controller: StripeSubscriptionController;
  let subscriptionService: jest.Mocked<StripeSubscriptionAdminService>;
  let mockReply: jest.Mocked<FastifyReply>;

  // Test data constants
  const TEST_IDS = {
    companyId: "company_123",
    subscriptionId: "sub_test123",
    priceId: "price_test123",
  };

  const MOCK_SUBSCRIPTION_RESPONSE = {
    data: {
      type: "subscriptions",
      id: TEST_IDS.subscriptionId,
      attributes: {
        stripeSubscriptionId: "stripe_sub_123",
        status: "active" as StripeSubscriptionStatus,
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
      header: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<FastifyReply>;
    return reply;
  };

  beforeEach(async () => {
    const mockStripeSubscriptionAdminService = {
      listSubscriptions: jest.fn(),
      getSubscription: jest.fn(),
      createSubscription: jest.fn(),
      cancelSubscription: jest.fn(),
      pauseSubscription: jest.fn(),
      resumeSubscription: jest.fn(),
      changePlan: jest.fn(),
      previewProration: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeSubscriptionController],
      providers: [
        {
          provide: StripeSubscriptionAdminService,
          useValue: mockStripeSubscriptionAdminService,
        },
      ],
    }).compile();

    controller = module.get<StripeSubscriptionController>(StripeSubscriptionController);
    subscriptionService = module.get(StripeSubscriptionAdminService);

    mockReply = createMockReply();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /subscriptions", () => {
    it("should list all subscriptions without status filter", async () => {
      const req = createMockRequest();
      const mockQuery = { page: { size: 10, number: 1 } };
      const mockSubscriptions = { data: [MOCK_SUBSCRIPTION_RESPONSE.data] };
      subscriptionService.listSubscriptions.mockResolvedValue(mockSubscriptions);

      await controller.listSubscriptions(req, mockReply, mockQuery, undefined);

      expect(subscriptionService.listSubscriptions).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        query: mockQuery,
        status: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockSubscriptions);
    });

    it("should list subscriptions with status filter", async () => {
      const req = createMockRequest();
      const mockQuery = { page: { size: 10, number: 1 } };
      const mockSubscriptions = { data: [MOCK_SUBSCRIPTION_RESPONSE.data] };
      subscriptionService.listSubscriptions.mockResolvedValue(mockSubscriptions);

      await controller.listSubscriptions(req, mockReply, mockQuery, "active");

      expect(subscriptionService.listSubscriptions).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        query: mockQuery,
        status: "active",
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockSubscriptions);
    });

    it("should pass query object from query params", async () => {
      const req = createMockRequest();
      const customQuery = { filter: { active: true }, page: { size: 20 } };
      subscriptionService.listSubscriptions.mockResolvedValue({ data: [] });

      await controller.listSubscriptions(req, mockReply, customQuery, undefined);

      expect(subscriptionService.listSubscriptions).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        query: customQuery,
        status: undefined,
      });
    });
  });

  describe("GET /subscriptions/:subscriptionId", () => {
    it("should get subscription by id successfully", async () => {
      const req = createMockRequest();
      subscriptionService.getSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.getSubscription(req, mockReply, TEST_IDS.subscriptionId);

      expect(subscriptionService.getSubscription).toHaveBeenCalledWith({
        id: TEST_IDS.subscriptionId,
        companyId: TEST_IDS.companyId,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_SUBSCRIPTION_RESPONSE);
    });

    it("should extract subscriptionId from path params", async () => {
      const req = createMockRequest();
      const customSubscriptionId = "sub_custom_789";
      subscriptionService.getSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.getSubscription(req, mockReply, customSubscriptionId);

      expect(subscriptionService.getSubscription).toHaveBeenCalledWith({
        id: customSubscriptionId,
        companyId: TEST_IDS.companyId,
      });
    });

    it("should handle service errors", async () => {
      const req = createMockRequest();
      const error = new Error("Subscription not found");
      subscriptionService.getSubscription.mockRejectedValue(error);

      await expect(controller.getSubscription(req, mockReply, TEST_IDS.subscriptionId)).rejects.toThrow(error);
    });
  });

  describe("POST /subscriptions", () => {
    it("should create subscription successfully with 201 status", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "subscriptions",
          id: "temp-id",
          attributes: {
            priceId: TEST_IDS.priceId,
            quantity: 1,
          },
        },
      };
      subscriptionService.createSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.createSubscription(req, mockReply, body as any);

      expect(subscriptionService.createSubscription).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        priceId: TEST_IDS.priceId,
        paymentMethodId: undefined,
        trialPeriodDays: undefined,
        quantity: 1,
      });
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_SUBSCRIPTION_RESPONSE);
    });

    it("should pass all body parameters to service", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "subscriptions",
          id: "temp-id",
          attributes: {
            priceId: TEST_IDS.priceId,
            paymentMethodId: "pm_123",
            trialPeriodDays: 14,
            quantity: 2,
          },
        },
      };
      subscriptionService.createSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.createSubscription(req, mockReply, body as any);

      expect(subscriptionService.createSubscription).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        priceId: TEST_IDS.priceId,
        paymentMethodId: "pm_123",
        trialPeriodDays: 14,
        quantity: 2,
      });
    });
  });

  describe("POST /subscriptions/:subscriptionId/cancel", () => {
    it("should cancel subscription successfully", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "subscriptions",
          id: TEST_IDS.subscriptionId,
          attributes: {
            cancelImmediately: false,
          },
        },
      };
      subscriptionService.cancelSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.cancelSubscription(req, mockReply, TEST_IDS.subscriptionId, body as any);

      expect(subscriptionService.cancelSubscription).toHaveBeenCalledWith({
        id: TEST_IDS.subscriptionId,
        companyId: TEST_IDS.companyId,
        cancelImmediately: false,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_SUBSCRIPTION_RESPONSE);
    });

    it("should cancel immediately when specified", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "subscriptions",
          id: TEST_IDS.subscriptionId,
          attributes: {
            cancelImmediately: true,
          },
        },
      };
      subscriptionService.cancelSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.cancelSubscription(req, mockReply, TEST_IDS.subscriptionId, body as any);

      expect(subscriptionService.cancelSubscription).toHaveBeenCalledWith({
        id: TEST_IDS.subscriptionId,
        companyId: TEST_IDS.companyId,
        cancelImmediately: true,
      });
    });

    it("should extract subscriptionId from path params", async () => {
      const req = createMockRequest();
      const customSubscriptionId = "sub_custom_789";
      const body = {
        data: {
          type: "subscriptions",
          id: customSubscriptionId,
          attributes: {},
        },
      };
      subscriptionService.cancelSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.cancelSubscription(req, mockReply, customSubscriptionId, body as any);

      expect(subscriptionService.cancelSubscription).toHaveBeenCalledWith({
        id: customSubscriptionId,
        companyId: TEST_IDS.companyId,
        cancelImmediately: undefined,
      });
    });
  });

  describe("POST /subscriptions/:subscriptionId/pause", () => {
    it("should pause subscription successfully", async () => {
      const req = createMockRequest();
      subscriptionService.pauseSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.pauseSubscription(req, mockReply, TEST_IDS.subscriptionId);

      expect(subscriptionService.pauseSubscription).toHaveBeenCalledWith({
        id: TEST_IDS.subscriptionId,
        companyId: TEST_IDS.companyId,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_SUBSCRIPTION_RESPONSE);
    });

    it("should extract subscriptionId from path params", async () => {
      const req = createMockRequest();
      const customSubscriptionId = "sub_pause_789";
      subscriptionService.pauseSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.pauseSubscription(req, mockReply, customSubscriptionId);

      expect(subscriptionService.pauseSubscription).toHaveBeenCalledWith({
        id: customSubscriptionId,
        companyId: TEST_IDS.companyId,
      });
    });
  });

  describe("POST /subscriptions/:subscriptionId/resume", () => {
    it("should resume subscription successfully", async () => {
      const req = createMockRequest();
      subscriptionService.resumeSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.resumeSubscription(req, mockReply, TEST_IDS.subscriptionId);

      expect(subscriptionService.resumeSubscription).toHaveBeenCalledWith({
        id: TEST_IDS.subscriptionId,
        companyId: TEST_IDS.companyId,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_SUBSCRIPTION_RESPONSE);
    });

    it("should extract subscriptionId from path params", async () => {
      const req = createMockRequest();
      const customSubscriptionId = "sub_resume_789";
      subscriptionService.resumeSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.resumeSubscription(req, mockReply, customSubscriptionId);

      expect(subscriptionService.resumeSubscription).toHaveBeenCalledWith({
        id: customSubscriptionId,
        companyId: TEST_IDS.companyId,
      });
    });
  });

  describe("POST /subscriptions/:subscriptionId/change-plan", () => {
    it("should change plan successfully", async () => {
      const req = createMockRequest();
      const newPriceId = "price_new_123";
      const body = {
        data: {
          type: "subscriptions",
          id: TEST_IDS.subscriptionId,
          attributes: {
            priceId: newPriceId,
          },
        },
      };
      subscriptionService.changePlan.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.changePlan(req, mockReply, TEST_IDS.subscriptionId, body as any);

      expect(subscriptionService.changePlan).toHaveBeenCalledWith({
        id: TEST_IDS.subscriptionId,
        companyId: TEST_IDS.companyId,
        newPriceId,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_SUBSCRIPTION_RESPONSE);
    });

    it("should return 400 BAD_REQUEST when priceId is missing", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "subscriptions",
          id: TEST_IDS.subscriptionId,
          attributes: {},
        },
      };

      await controller.changePlan(req, mockReply, TEST_IDS.subscriptionId, body as any);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "priceId is required" });
      expect(subscriptionService.changePlan).not.toHaveBeenCalled();
    });

    it("should return 400 BAD_REQUEST when priceId is null", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "subscriptions",
          id: TEST_IDS.subscriptionId,
          attributes: {
            priceId: null,
          },
        },
      };

      await controller.changePlan(req, mockReply, TEST_IDS.subscriptionId, body as any);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "priceId is required" });
      expect(subscriptionService.changePlan).not.toHaveBeenCalled();
    });

    it("should return 400 BAD_REQUEST when priceId is empty string", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "subscriptions",
          id: TEST_IDS.subscriptionId,
          attributes: {
            priceId: "",
          },
        },
      };

      await controller.changePlan(req, mockReply, TEST_IDS.subscriptionId, body as any);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "priceId is required" });
      expect(subscriptionService.changePlan).not.toHaveBeenCalled();
    });

    it("should extract subscriptionId from path params", async () => {
      const req = createMockRequest();
      const customSubscriptionId = "sub_change_789";
      const body = {
        data: {
          type: "subscriptions",
          id: customSubscriptionId,
          attributes: {
            priceId: "price_new_456",
          },
        },
      };
      subscriptionService.changePlan.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);

      await controller.changePlan(req, mockReply, customSubscriptionId, body as any);

      expect(subscriptionService.changePlan).toHaveBeenCalledWith({
        id: customSubscriptionId,
        companyId: TEST_IDS.companyId,
        newPriceId: "price_new_456",
      });
    });
  });

  describe("GET /subscriptions/:subscriptionId/proration-preview", () => {
    it("should preview proration successfully", async () => {
      const req = createMockRequest();
      const priceId = "price_new_123";
      const mockProration = {
        currentPrice: 1000,
        newPrice: 1500,
        prorationAmount: 500,
        nextInvoiceAmount: 1500,
      };
      subscriptionService.previewProration.mockResolvedValue(mockProration);

      await controller.previewProration(req, mockReply, TEST_IDS.subscriptionId, priceId);

      expect(subscriptionService.previewProration).toHaveBeenCalledWith({
        id: TEST_IDS.subscriptionId,
        companyId: TEST_IDS.companyId,
        newPriceId: priceId,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockProration);
    });

    it("should return 400 BAD_REQUEST when priceId query param is missing", async () => {
      const req = createMockRequest();

      await controller.previewProration(req, mockReply, TEST_IDS.subscriptionId, undefined as any);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "priceId query parameter is required" });
      expect(subscriptionService.previewProration).not.toHaveBeenCalled();
    });

    it("should return 400 BAD_REQUEST when priceId query param is empty string", async () => {
      const req = createMockRequest();

      await controller.previewProration(req, mockReply, TEST_IDS.subscriptionId, "");

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "priceId query parameter is required" });
      expect(subscriptionService.previewProration).not.toHaveBeenCalled();
    });

    it("should extract priceId from query params", async () => {
      const req = createMockRequest();
      const customPriceId = "price_custom_proration_456";
      subscriptionService.previewProration.mockResolvedValue({} as any);

      await controller.previewProration(req, mockReply, TEST_IDS.subscriptionId, customPriceId);

      expect(subscriptionService.previewProration).toHaveBeenCalledWith({
        id: TEST_IDS.subscriptionId,
        companyId: TEST_IDS.companyId,
        newPriceId: customPriceId,
      });
    });

    it("should extract subscriptionId from path params", async () => {
      const req = createMockRequest();
      const customSubscriptionId = "sub_proration_789";
      const priceId = "price_123";
      subscriptionService.previewProration.mockResolvedValue({} as any);

      await controller.previewProration(req, mockReply, customSubscriptionId, priceId);

      expect(subscriptionService.previewProration).toHaveBeenCalledWith({
        id: customSubscriptionId,
        companyId: TEST_IDS.companyId,
        newPriceId: priceId,
      });
    });
  });
});
