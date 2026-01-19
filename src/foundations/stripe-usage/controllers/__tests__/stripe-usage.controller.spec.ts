import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { StripeUsageController } from "../stripe-usage.controller";
import { StripeUsageAdminService } from "../../services/stripe-usage-admin.service";
import { AuthenticatedRequest } from "@carlonicora/nestjs-neo4jsonapi";

describe("StripeUsageController", () => {
  let controller: StripeUsageController;
  let usageService: vi.Mocked<StripeUsageAdminService>;
  let mockReply: vi.Mocked<FastifyReply>;

  // Test data constants
  const TEST_IDS = {
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    userId: "550e8400-e29b-41d4-a716-446655440001",
    subscriptionId: "aa0e8400-e29b-41d4-a716-446655440001",
    meterId: "bb0e8400-e29b-41d4-a716-446655440001",
    usageRecordId: "cc0e8400-e29b-41d4-a716-446655440001",
  };

  const MOCK_METERS_RESPONSE = {
    data: [
      {
        type: "meters",
        id: TEST_IDS.meterId,
        attributes: {
          displayName: "API Requests",
          eventName: "api_requests",
          status: "active",
        },
      },
    ],
  };

  const MOCK_METER_SUMMARIES_RESPONSE = {
    data: [
      {
        aggregatedValue: 1000,
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-31T23:59:59.999Z",
      },
    ],
  };

  const MOCK_USAGE_RECORD_RESPONSE = {
    data: {
      type: "stripe-usage-records",
      id: TEST_IDS.usageRecordId,
      attributes: {
        meterId: TEST_IDS.meterId,
        quantity: 100,
        timestamp: "2024-01-15T12:00:00.000Z",
      },
    },
  };

  const MOCK_USAGE_RECORDS_LIST_RESPONSE = {
    data: [MOCK_USAGE_RECORD_RESPONSE.data],
    meta: { total: 1 },
  };

  const MOCK_USAGE_SUMMARY_RESPONSE = {
    totalQuantity: 1000,
    periodStart: "2024-01-01T00:00:00.000Z",
    periodEnd: "2024-01-31T23:59:59.999Z",
  };

  // Create a mock authenticated request
  const createMockRequest = (companyId: string = TEST_IDS.companyId): AuthenticatedRequest => {
    return {
      user: {
        companyId,
        userId: TEST_IDS.userId,
      },
    } as AuthenticatedRequest;
  };

  // Create a mock Fastify reply
  const createMockReply = (): vi.Mocked<FastifyReply> => {
    const reply = {
      send: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as vi.Mocked<FastifyReply>;
    return reply;
  };

  beforeEach(async () => {
    const mockStripeUsageAdminService = {
      listMeters: vi.fn(),
      getMeterEventSummaries: vi.fn(),
      reportUsage: vi.fn(),
      listUsageRecords: vi.fn(),
      getUsageSummary: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeUsageController],
      providers: [
        {
          provide: StripeUsageAdminService,
          useValue: mockStripeUsageAdminService,
        },
      ],
    }).compile();

    controller = module.get<StripeUsageController>(StripeUsageController);
    usageService = module.get(StripeUsageAdminService);

    mockReply = createMockReply();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /stripe-usage-records/meters", () => {
    it("should list all billing meters", async () => {
      const req = createMockRequest();
      usageService.listMeters.mockResolvedValue(MOCK_METERS_RESPONSE);

      await controller.listMeters(req, mockReply);

      expect(usageService.listMeters).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_METERS_RESPONSE);
    });

    it("should handle service errors", async () => {
      const req = createMockRequest();
      const error = new Error("Stripe API error");
      usageService.listMeters.mockRejectedValue(error);

      await expect(controller.listMeters(req, mockReply)).rejects.toThrow(error);
    });
  });

  describe("GET /stripe-usage-records/meters/:meterId/summaries", () => {
    const startTime = "2024-01-01T00:00:00.000Z";
    const endTime = "2024-01-31T23:59:59.999Z";

    it("should get meter event summaries successfully", async () => {
      const req = createMockRequest();
      usageService.getMeterEventSummaries.mockResolvedValue(MOCK_METER_SUMMARIES_RESPONSE);

      await controller.getMeterSummaries(req, mockReply, TEST_IDS.meterId, startTime, endTime);

      expect(usageService.getMeterEventSummaries).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        meterId: TEST_IDS.meterId,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_METER_SUMMARIES_RESPONSE);
    });

    it("should return 400 when startTime is missing", async () => {
      const req = createMockRequest();

      await controller.getMeterSummaries(req, mockReply, TEST_IDS.meterId, undefined as any, endTime);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "startTime and endTime query parameters are required" });
      expect(usageService.getMeterEventSummaries).not.toHaveBeenCalled();
    });

    it("should return 400 when endTime is missing", async () => {
      const req = createMockRequest();

      await controller.getMeterSummaries(req, mockReply, TEST_IDS.meterId, startTime, undefined as any);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "startTime and endTime query parameters are required" });
      expect(usageService.getMeterEventSummaries).not.toHaveBeenCalled();
    });

    it("should extract meterId from path params", async () => {
      const req = createMockRequest();
      const customMeterId = "meter_custom_456";
      usageService.getMeterEventSummaries.mockResolvedValue(MOCK_METER_SUMMARIES_RESPONSE);

      await controller.getMeterSummaries(req, mockReply, customMeterId, startTime, endTime);

      expect(usageService.getMeterEventSummaries).toHaveBeenCalledWith(
        expect.objectContaining({ meterId: customMeterId }),
      );
    });
  });

  describe("POST /stripe-usage-records", () => {
    it("should report usage successfully with 201 status", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "stripe-usage-records",
          attributes: {
            meterId: TEST_IDS.meterId,
            meterEventName: "api_requests",
            quantity: 100,
            timestamp: "2024-01-15T12:00:00.000Z",
          },
          relationships: {
            subscription: {
              data: {
                type: "stripe-subscriptions",
                id: TEST_IDS.subscriptionId,
              },
            },
          },
        },
      };
      usageService.reportUsage.mockResolvedValue(MOCK_USAGE_RECORD_RESPONSE);

      await controller.reportUsage(req, mockReply, body as any);

      expect(usageService.reportUsage).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        subscriptionId: TEST_IDS.subscriptionId,
        meterId: TEST_IDS.meterId,
        meterEventName: "api_requests",
        quantity: 100,
        timestamp: new Date("2024-01-15T12:00:00.000Z"),
      });
      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_USAGE_RECORD_RESPONSE);
    });

    it("should report usage without timestamp", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "stripe-usage-records",
          attributes: {
            meterId: TEST_IDS.meterId,
            meterEventName: "api_requests",
            quantity: 50,
          },
          relationships: {
            subscription: {
              data: {
                type: "stripe-subscriptions",
                id: TEST_IDS.subscriptionId,
              },
            },
          },
        },
      };
      usageService.reportUsage.mockResolvedValue(MOCK_USAGE_RECORD_RESPONSE);

      await controller.reportUsage(req, mockReply, body as any);

      expect(usageService.reportUsage).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        subscriptionId: TEST_IDS.subscriptionId,
        meterId: TEST_IDS.meterId,
        meterEventName: "api_requests",
        quantity: 50,
        timestamp: undefined,
      });
    });

    it("should handle service errors", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "stripe-usage-records",
          attributes: {
            meterId: TEST_IDS.meterId,
            meterEventName: "api_requests",
            quantity: 100,
          },
          relationships: {
            subscription: {
              data: {
                type: "stripe-subscriptions",
                id: TEST_IDS.subscriptionId,
              },
            },
          },
        },
      };
      const error = new Error("Subscription not found");
      usageService.reportUsage.mockRejectedValue(error);

      await expect(controller.reportUsage(req, mockReply, body as any)).rejects.toThrow(error);
    });
  });

  describe("GET /stripe-usage-records", () => {
    it("should list usage records with required subscription filter", async () => {
      const req = createMockRequest();
      const mockQuery = { page: { size: 10, number: 1 } };
      usageService.listUsageRecords.mockResolvedValue(MOCK_USAGE_RECORDS_LIST_RESPONSE);

      await controller.listUsageRecords(req, mockReply, mockQuery, TEST_IDS.subscriptionId, undefined, undefined);

      expect(usageService.listUsageRecords).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        subscriptionId: TEST_IDS.subscriptionId,
        query: mockQuery,
        startTime: undefined,
        endTime: undefined,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_USAGE_RECORDS_LIST_RESPONSE);
    });

    it("should list usage records with time range filters", async () => {
      const req = createMockRequest();
      const mockQuery = {};
      const startTime = "2024-01-01T00:00:00.000Z";
      const endTime = "2024-01-31T23:59:59.999Z";
      usageService.listUsageRecords.mockResolvedValue(MOCK_USAGE_RECORDS_LIST_RESPONSE);

      await controller.listUsageRecords(req, mockReply, mockQuery, TEST_IDS.subscriptionId, startTime, endTime);

      expect(usageService.listUsageRecords).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        subscriptionId: TEST_IDS.subscriptionId,
        query: mockQuery,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
      });
    });

    it("should return 400 when subscriptionId filter is missing", async () => {
      const req = createMockRequest();

      await controller.listUsageRecords(req, mockReply, {}, undefined, undefined, undefined);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({
        errors: [
          { status: "400", title: "Missing filter", detail: "filter[subscriptionId] query parameter is required" },
        ],
      });
      expect(usageService.listUsageRecords).not.toHaveBeenCalled();
    });
  });

  describe("GET /stripe-usage-records/summary", () => {
    const startTime = "2024-01-01T00:00:00.000Z";
    const endTime = "2024-01-31T23:59:59.999Z";

    it("should get usage summary successfully", async () => {
      const req = createMockRequest();
      usageService.getUsageSummary.mockResolvedValue(MOCK_USAGE_SUMMARY_RESPONSE);

      await controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, startTime, endTime);

      expect(usageService.getUsageSummary).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        subscriptionId: TEST_IDS.subscriptionId,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_USAGE_SUMMARY_RESPONSE);
    });

    it("should return 400 when subscriptionId is missing", async () => {
      const req = createMockRequest();

      await controller.getUsageSummary(req, mockReply, undefined as any, startTime, endTime);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({
        errors: [
          { status: "400", title: "Missing filter", detail: "filter[subscriptionId] query parameter is required" },
        ],
      });
      expect(usageService.getUsageSummary).not.toHaveBeenCalled();
    });

    it("should return 400 when startTime is missing", async () => {
      const req = createMockRequest();

      await controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, undefined as any, endTime);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({
        errors: [
          { status: "400", title: "Missing parameters", detail: "startTime and endTime query parameters are required" },
        ],
      });
      expect(usageService.getUsageSummary).not.toHaveBeenCalled();
    });

    it("should return 400 when endTime is missing", async () => {
      const req = createMockRequest();

      await controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, startTime, undefined as any);

      expect(mockReply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockReply.send).toHaveBeenCalledWith({
        errors: [
          { status: "400", title: "Missing parameters", detail: "startTime and endTime query parameters are required" },
        ],
      });
      expect(usageService.getUsageSummary).not.toHaveBeenCalled();
    });

    it("should handle service errors", async () => {
      const req = createMockRequest();
      const error = new Error("Subscription not found");
      usageService.getUsageSummary.mockRejectedValue(error);

      await expect(
        controller.getUsageSummary(req, mockReply, TEST_IDS.subscriptionId, startTime, endTime),
      ).rejects.toThrow(error);
    });
  });
});
