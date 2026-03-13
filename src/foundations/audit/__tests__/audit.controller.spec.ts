import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
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
    entityId: "660e8400-e29b-41d4-a716-446655440002",
  };

  const createMockRequest = (): AuthenticatedRequest => {
    return {
      user: { userId: TEST_IDS.userId, companyId: TEST_IDS.companyId },
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
      findByEntity: vi.fn(),
      findByUser: vi.fn(),
      findActivityByEntity: vi.fn(),
      logCreate: vi.fn(),
      logRead: vi.fn(),
      logUpdate: vi.fn(),
      logDelete: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: mockAuditService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuditController>(AuditController);
    auditService = module.get(AuditService);
    mockReply = createMockReply();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findActivityByEntity (GET audit-logs/activity/:entityType/:entityId)", () => {
    it("should call auditService.findActivityByEntity and send response", async () => {
      const mockResponse = { data: [], included: [] };
      auditService.findActivityByEntity.mockResolvedValue(mockResponse);

      await controller.findActivityByEntity(mockReply, {}, "Account", "entity-123");

      expect(auditService.findActivityByEntity).toHaveBeenCalledWith({
        entityType: "Account",
        entityId: "entity-123",
        query: {},
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
    });

    it("should propagate service errors", async () => {
      auditService.findActivityByEntity.mockRejectedValue(new Error("DB error"));

      await expect(controller.findActivityByEntity(mockReply, {}, "Account", "entity-123")).rejects.toThrow("DB error");
    });
  });

  describe("findByEntity (GET audit-logs/:entityType/:entityId)", () => {
    it("should call auditService.findByEntity with params", async () => {
      const mockResponse = { data: [] };
      auditService.findByEntity.mockResolvedValue(mockResponse);

      await controller.findByEntity(mockReply, {}, "Quote", TEST_IDS.entityId);

      expect(auditService.findByEntity).toHaveBeenCalledWith({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        query: {},
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
    });

    it("should propagate service errors", async () => {
      auditService.findByEntity.mockRejectedValue(new Error("DB error"));

      await expect(controller.findByEntity(mockReply, {}, "Quote", TEST_IDS.entityId)).rejects.toThrow("DB error");
    });
  });

  describe("findByUser (GET users/:userId/audit-logs)", () => {
    it("should call auditService.findByUser with userId and query", async () => {
      const req = createMockRequest();
      const mockResponse = { data: [] };
      auditService.findByUser.mockResolvedValue(mockResponse);

      await controller.findByUser(req, mockReply, {}, TEST_IDS.userId);

      expect(auditService.findByUser).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        query: {},
      });
      expect(mockReply.send).toHaveBeenCalledWith(mockResponse);
    });

    it("should propagate service errors", async () => {
      const req = createMockRequest();
      auditService.findByUser.mockRejectedValue(new Error("DB error"));

      await expect(controller.findByUser(req, mockReply, {}, TEST_IDS.userId)).rejects.toThrow("DB error");
    });
  });
});
