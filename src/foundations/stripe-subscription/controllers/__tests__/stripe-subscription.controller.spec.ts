import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../chunker/chunker.module", () => ({
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
import { HttpException, HttpStatus } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { StripeSubscriptionController } from "../stripe-subscription.controller";
import { StripeSubscriptionAdminService } from "../../services/stripe-subscription-admin.service";
import { CacheService } from "../../../../core/cache/services/cache.service";
import { RoleId } from "../../../../common/constants/system.roles";
import { AuthenticatedRequest } from "@carlonicora/nestjs-neo4jsonapi";
import type { StripeSubscriptionStatus } from "../../entities/stripe-subscription";
import type {
  JsonApiListDocument,
  JsonApiSingleDocument,
} from "../../../../core/jsonapi/interfaces/jsonapi.document.interface";

describe("StripeSubscriptionController", () => {
  let controller: StripeSubscriptionController;
  let subscriptionService: Mocked<StripeSubscriptionAdminService>;
  let mockReply: Mocked<FastifyReply>;
  let cacheService: { invalidateByElement: ReturnType<typeof vi.fn>; invalidateByType: ReturnType<typeof vi.fn> };

  // Test data constants
  const TEST_IDS = {
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    subscriptionId: "sub_test123",
    priceId: "price_test123",
  };

  const MOCK_SUBSCRIPTION_RESPONSE: JsonApiSingleDocument = {
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
  // @CacheInvalidate(meta, "subscriptionId") reads the URL param from the request
  const createMockRequest = (
    companyId: string = TEST_IDS.companyId,
    subscriptionId: string = TEST_IDS.subscriptionId,
  ): AuthenticatedRequest => {
    return {
      user: {
        companyId,
        userId: "550e8400-e29b-41d4-a716-446655440001",
      },
      params: { subscriptionId },
    } as unknown as AuthenticatedRequest;
  };

  // Create a mock Fastify reply
  const createMockReply = (): Mocked<FastifyReply> => {
    const reply = {
      send: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as Mocked<FastifyReply>;
    return reply;
  };

  beforeEach(async () => {
    const mockStripeSubscriptionAdminService = {
      listSubscriptions: vi.fn(),
      getSubscription: vi.fn(),
      createSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      changePlan: vi.fn(),
      previewProration: vi.fn(),
      syncSubscriptionFromStripe: vi.fn(),
    };

    cacheService = {
      invalidateByElement: vi.fn().mockResolvedValue(undefined),
      invalidateByType: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeSubscriptionController],
      providers: [
        {
          provide: StripeSubscriptionAdminService,
          useValue: mockStripeSubscriptionAdminService,
        },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    controller = module.get<StripeSubscriptionController>(StripeSubscriptionController);
    subscriptionService = module.get(StripeSubscriptionAdminService);

    mockReply = createMockReply();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /subscriptions", () => {
    it("should list all subscriptions without status filter", async () => {
      const req = createMockRequest();
      const mockQuery = { page: { size: 10, number: 1 } };
      const mockSubscriptions: JsonApiListDocument = { data: [MOCK_SUBSCRIPTION_RESPONSE.data] };
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
      const mockSubscriptions: JsonApiListDocument = { data: [MOCK_SUBSCRIPTION_RESPONSE.data] };
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
            quantity: 1,
          },
          relationships: {
            stripePrice: {
              data: {
                type: "stripe-prices",
                id: TEST_IDS.priceId,
              },
            },
          },
        },
      };
      const mockServiceResponse = {
        data: MOCK_SUBSCRIPTION_RESPONSE,
        clientSecret: "pi_secret",
        paymentIntentId: "pi_123",
        requiresAction: false,
      };
      subscriptionService.createSubscription.mockResolvedValue(mockServiceResponse);

      await controller.createSubscription(req, mockReply, body as any);

      expect(subscriptionService.createSubscription).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        priceId: TEST_IDS.priceId,
        paymentMethodId: undefined,
        trialPeriodDays: undefined,
        quantity: 1,
      });
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.CREATED);
    });

    it("should pass all body parameters to service", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "subscriptions",
          id: "temp-id",
          attributes: {
            paymentMethodId: "pm_123",
            trialPeriodDays: 14,
            quantity: 2,
          },
          relationships: {
            stripePrice: {
              data: {
                type: "stripe-prices",
                id: TEST_IDS.priceId,
              },
            },
          },
        },
      };
      const mockServiceResponse = {
        data: MOCK_SUBSCRIPTION_RESPONSE,
        clientSecret: "pi_secret",
        paymentIntentId: "pi_123",
        requiresAction: false,
      };
      subscriptionService.createSubscription.mockResolvedValue(mockServiceResponse);

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

  describe("decorators on the mutation routes", () => {
    const prototype = StripeSubscriptionController.prototype as unknown as Record<string, unknown>;
    const elementRoutes = ["cancelSubscription", "changePlan"];

    it("mutations invalidate the subscription cache", async () => {
      const req = createMockRequest();
      subscriptionService.cancelSubscription.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);
      subscriptionService.changePlan.mockResolvedValue(MOCK_SUBSCRIPTION_RESPONSE);
      subscriptionService.createSubscription.mockResolvedValue({
        data: MOCK_SUBSCRIPTION_RESPONSE,
        clientSecret: null,
        paymentIntentId: null,
        requiresAction: false,
      });
      const body = { data: { type: "stripe-subscriptions", id: TEST_IDS.subscriptionId, attributes: {} } } as any;

      await controller.cancelSubscription(req, mockReply, TEST_IDS.subscriptionId, body);
      await controller.changePlan(req, mockReply, TEST_IDS.subscriptionId, {
        data: { ...body.data, attributes: { priceId: TEST_IDS.priceId } },
      } as any);

      expect(cacheService.invalidateByElement).toHaveBeenCalledTimes(2);
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("stripe-subscriptions", TEST_IDS.subscriptionId);

      await controller.createSubscription(req, mockReply, {
        data: {
          type: "stripe-subscriptions",
          id: TEST_IDS.subscriptionId,
          relationships: { stripePrice: { data: { type: "stripe-prices", id: TEST_IDS.priceId } } },
        },
      } as any);

      expect(cacheService.invalidateByType).toHaveBeenCalledWith("stripe-subscriptions");
    });

    it("roles are still enforced on decorated routes", () => {
      for (const route of elementRoutes) {
        expect(Reflect.getMetadata("roles", prototype[route] as object)).toEqual([RoleId.CompanyAdministrator]);
      }
      expect(Reflect.getMetadata("roles", prototype.createSubscription as object)).toEqual([
        RoleId.CompanyAdministrator,
      ]);
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

  describe("POST /stripe-subscriptions/:subscriptionId/sync", () => {
    const createRequestWithParams = (companyId: string = TEST_IDS.companyId): AuthenticatedRequest =>
      ({ ...createMockRequest(companyId), params: { subscriptionId: TEST_IDS.subscriptionId } }) as any;

    it("is limited to company administrators", () => {
      const roles = Reflect.getMetadata("roles", StripeSubscriptionController.prototype.syncSubscription);
      expect(roles).toEqual([RoleId.CompanyAdministrator]);
    });

    it("checks ownership, re-reads the subscription from Stripe and answers with the stored one", async () => {
      const req = createRequestWithParams();
      const synced: JsonApiSingleDocument = {
        data: {
          ...MOCK_SUBSCRIPTION_RESPONSE.data,
          attributes: { stripeSubscriptionId: "stripe_sub_123", status: "active" },
        },
      };
      subscriptionService.getSubscription
        .mockResolvedValueOnce({
          data: {
            ...MOCK_SUBSCRIPTION_RESPONSE.data,
            attributes: { stripeSubscriptionId: "stripe_sub_123", status: "incomplete" },
          },
        })
        .mockResolvedValueOnce(synced);
      subscriptionService.syncSubscriptionFromStripe.mockResolvedValue(undefined);

      await controller.syncSubscription(req, mockReply, TEST_IDS.subscriptionId);

      expect(subscriptionService.getSubscription).toHaveBeenNthCalledWith(1, {
        id: TEST_IDS.subscriptionId,
        companyId: TEST_IDS.companyId,
      });
      expect(subscriptionService.syncSubscriptionFromStripe).toHaveBeenCalledWith({
        stripeSubscriptionId: "stripe_sub_123",
      });
      expect(mockReply.send).toHaveBeenCalledWith(synced);
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("stripe-subscriptions", TEST_IDS.subscriptionId);
    });

    it("never syncs a subscription of another company", async () => {
      const req = createRequestWithParams("other-company");
      subscriptionService.getSubscription.mockRejectedValue(
        new HttpException("Subscription does not belong to this company", HttpStatus.FORBIDDEN),
      );

      await expect(controller.syncSubscription(req, mockReply, TEST_IDS.subscriptionId)).rejects.toThrow(
        "Subscription does not belong to this company",
      );

      expect(subscriptionService.syncSubscriptionFromStripe).not.toHaveBeenCalled();
      expect(cacheService.invalidateByElement).not.toHaveBeenCalled();
    });

    it("answers 400 when the subscription has no Stripe id", async () => {
      const req = createRequestWithParams();
      subscriptionService.getSubscription.mockResolvedValue({
        data: { ...MOCK_SUBSCRIPTION_RESPONSE.data, attributes: { status: "incomplete" } },
      });

      await controller.syncSubscription(req, mockReply, TEST_IDS.subscriptionId);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(subscriptionService.syncSubscriptionFromStripe).not.toHaveBeenCalled();
    });
  });
});
