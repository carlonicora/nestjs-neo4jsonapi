import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { FastifyReply } from "fastify";
import { AuditController } from "../controllers/audit.controller";
import { AuditService } from "../services/audit.service";
import { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";

describe("AuditController", () => {
  let controller: AuditController;
  let auditService: vi.Mocked<AuditService>;
  let mockReply: vi.Mocked<FastifyReply>;

  const TEST_IDS = {
    userId: "550e8400-e29b-41d4-a716-446655440001",
    companyId: "550e8400-e29b-41d4-a716-446655440000",
  };

  const createMockRequest = (userId: string = TEST_IDS.userId): AuthenticatedRequest => {
    return {
      user: {
        userId,
        companyId: TEST_IDS.companyId,
      },
    } as AuthenticatedRequest;
  };

  const createMockReply = (): vi.Mocked<FastifyReply> => {
    return {
      send: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
    } as unknown as vi.Mocked<FastifyReply>;
  };

  beforeEach(async () => {
    const mockAuditService = {
      findByUser: vi.fn(),
      createAuditEntry: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: mockAuditService }],
    }).compile();

    controller = module.get<AuditController>(AuditController);
    auditService = module.get(AuditService);
    mockReply = createMockReply();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findAccounts (GET users/:userId/audits)", () => {
    it("should call auditService.findByUser with userId and query", async () => {
      const req = createMockRequest();
      const query = { page: 1, limit: 10 };
      const mockResponse = {
        data: [
          {
            type: "audits",
            id: "audit-123",
            attributes: { entityType: "content", entityId: "content-456" },
          },
        ],
      };
      auditService.findByUser.mockResolvedValue(mockResponse as any);

      await controller.findAccounts(req, mockReply, query, TEST_IDS.userId);

      expect(auditService.findByUser).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        query,
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
    });

    it("should pass userId from path params", async () => {
      const req = createMockRequest();
      const customUserId = "custom-user-123";
      auditService.findByUser.mockResolvedValue({ data: [] } as any);

      await controller.findAccounts(req, mockReply, {}, customUserId);

      expect(auditService.findByUser).toHaveBeenCalledWith({
        userId: customUserId,
        query: {},
      });
    });

    it("should handle empty query params", async () => {
      const req = createMockRequest();
      auditService.findByUser.mockResolvedValue({ data: [] } as any);

      await controller.findAccounts(req, mockReply, {}, TEST_IDS.userId);

      expect(auditService.findByUser).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        query: {},
      });
    });

    it("should propagate service errors", async () => {
      const req = createMockRequest();
      const error = new Error("Database error");
      auditService.findByUser.mockRejectedValue(error);

      await expect(controller.findAccounts(req, mockReply, {}, TEST_IDS.userId)).rejects.toThrow("Database error");
    });

    it("should send response via Fastify reply", async () => {
      const req = createMockRequest();
      const mockData = { data: [], meta: { total: 0 } };
      auditService.findByUser.mockResolvedValue(mockData as any);

      await controller.findAccounts(req, mockReply, {}, TEST_IDS.userId);

      expect(mockReply.send).toHaveBeenCalledOnce();
      expect(mockReply.send).toHaveBeenCalledWith(mockData);
    });
  });

  describe("dependency injection", () => {
    it("should have auditService injected", () => {
      expect(controller["auditService"]).toBeDefined();
    });
  });
});
