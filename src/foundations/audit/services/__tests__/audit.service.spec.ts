import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { AuditService } from "../audit.service";
import { AuditRepository } from "../../repositories/audit.repository";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";

describe("AuditService", () => {
  let service: AuditService;
  let auditRepository: MockedObject<AuditRepository>;
  let jsonApiService: MockedObject<JsonApiService>;
  let clsService: MockedObject<ClsService>;

  const TEST_IDS = {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    entityId: "660e8400-e29b-41d4-a716-446655440001",
    auditId: "770e8400-e29b-41d4-a716-446655440002",
  };

  const createMockAuditRepository = () => ({
    create: vi.fn(),
    findByUser: vi.fn(),
    findById: vi.fn(),
    delete: vi.fn(),
  });

  const createMockJsonApiService = () => ({
    buildList: vi.fn(),
    buildSingle: vi.fn(),
    buildError: vi.fn(),
  });

  const createMockClsService = () => ({
    get: vi.fn(),
    set: vi.fn(),
    run: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockAuditRepository = createMockAuditRepository();
    const mockJsonApiService = createMockJsonApiService();
    const mockClsService = createMockClsService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: AuditRepository, useValue: mockAuditRepository },
        { provide: JsonApiService, useValue: mockJsonApiService },
        { provide: ClsService, useValue: mockClsService },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    auditRepository = module.get(AuditRepository) as MockedObject<AuditRepository>;
    jsonApiService = module.get(JsonApiService) as MockedObject<JsonApiService>;
    clsService = module.get(ClsService) as MockedObject<ClsService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("createAuditEntry", () => {
    it("should create an audit entry when userId is available", async () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.userId);
      auditRepository.create.mockResolvedValue(undefined);

      // Act
      await service.createAuditEntry({
        entityType: "content",
        entityId: TEST_IDS.entityId,
      });

      // Assert
      expect(clsService.get).toHaveBeenCalledWith("userId");
      expect(auditRepository.create).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        entityType: "content",
        entityId: TEST_IDS.entityId,
        auditType: "read",
        changes: undefined,
      });
    });

    it("should not create an audit entry when userId is not available", async () => {
      // Arrange
      clsService.get.mockReturnValue(undefined);

      // Act
      await service.createAuditEntry({
        entityType: "content",
        entityId: TEST_IDS.entityId,
      });

      // Assert
      expect(clsService.get).toHaveBeenCalledWith("userId");
      expect(auditRepository.create).not.toHaveBeenCalled();
    });

    it("should not create an audit entry when userId is null", async () => {
      // Arrange
      clsService.get.mockReturnValue(null);

      // Act
      await service.createAuditEntry({
        entityType: "content",
        entityId: TEST_IDS.entityId,
      });

      // Assert
      expect(auditRepository.create).not.toHaveBeenCalled();
    });

    it("should always set auditType to read", async () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.userId);
      auditRepository.create.mockResolvedValue(undefined);

      // Act
      await service.createAuditEntry({
        entityType: "anyEntityType",
        entityId: TEST_IDS.entityId,
      });

      // Assert
      expect(auditRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          auditType: "read",
          changes: undefined,
        }),
      );
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.userId);
      auditRepository.create.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(
        service.createAuditEntry({
          entityType: "content",
          entityId: TEST_IDS.entityId,
        }),
      ).rejects.toThrow("Database error");
    });
  });

  describe("createWriteAuditEntry", () => {
    it("should create a write audit entry with auditType 'create' and no changes", async () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.userId);
      auditRepository.create.mockResolvedValue(undefined);

      // Act
      await service.createWriteAuditEntry({
        entityType: "Warehouse",
        entityId: TEST_IDS.entityId,
        auditType: "create",
      });

      // Assert
      expect(clsService.get).toHaveBeenCalledWith("userId");
      expect(auditRepository.create).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        entityType: "Warehouse",
        entityId: TEST_IDS.entityId,
        auditType: "create",
        changes: undefined,
      });
    });

    it("should create a write audit entry with auditType 'edit' and changes JSON", async () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.userId);
      auditRepository.create.mockResolvedValue(undefined);
      const changesJson = JSON.stringify({ attributes: { name: "Updated" } });

      // Act
      await service.createWriteAuditEntry({
        entityType: "Warehouse",
        entityId: TEST_IDS.entityId,
        auditType: "edit",
        changes: changesJson,
      });

      // Assert
      expect(auditRepository.create).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        entityType: "Warehouse",
        entityId: TEST_IDS.entityId,
        auditType: "edit",
        changes: changesJson,
      });
    });

    it("should create a write audit entry with auditType 'edit' and no changes", async () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.userId);
      auditRepository.create.mockResolvedValue(undefined);

      // Act
      await service.createWriteAuditEntry({
        entityType: "Warehouse",
        entityId: TEST_IDS.entityId,
        auditType: "edit",
      });

      // Assert
      expect(auditRepository.create).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        entityType: "Warehouse",
        entityId: TEST_IDS.entityId,
        auditType: "edit",
        changes: undefined,
      });
    });

    it("should not create audit entry when userId is not available", async () => {
      // Arrange
      clsService.get.mockReturnValue(undefined);

      // Act
      await service.createWriteAuditEntry({
        entityType: "Warehouse",
        entityId: TEST_IDS.entityId,
        auditType: "create",
      });

      // Assert
      expect(clsService.get).toHaveBeenCalledWith("userId");
      expect(auditRepository.create).not.toHaveBeenCalled();
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.userId);
      auditRepository.create.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(
        service.createWriteAuditEntry({
          entityType: "Warehouse",
          entityId: TEST_IDS.entityId,
          auditType: "create",
        }),
      ).rejects.toThrow("Database error");
    });
  });

  describe("findByUser", () => {
    it("should find audit entries by user with pagination", async () => {
      // Arrange
      const mockAuditEntries = [{ id: TEST_IDS.auditId, entityType: "content", entityId: TEST_IDS.entityId }];
      const mockJsonApiResponse = { data: mockAuditEntries };
      auditRepository.findByUser.mockResolvedValue(mockAuditEntries);
      jsonApiService.buildList.mockReturnValue(mockJsonApiResponse as any);

      // Act
      const result = await service.findByUser({
        query: {},
        userId: TEST_IDS.userId,
      });

      // Assert
      expect(auditRepository.findByUser).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        cursor: expect.anything(),
      });
      expect(jsonApiService.buildList).toHaveBeenCalled();
      expect(result).toBe(mockJsonApiResponse);
    });

    it("should pass pagination parameters from query", async () => {
      // Arrange
      const query = { page: { size: 10, after: "cursor123" } };
      auditRepository.findByUser.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] } as any);

      // Act
      await service.findByUser({
        query,
        userId: TEST_IDS.userId,
      });

      // Assert
      expect(auditRepository.findByUser).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        cursor: expect.anything(),
      });
    });

    it("should propagate errors from repository", async () => {
      // Arrange
      auditRepository.findByUser.mockRejectedValue(new Error("Repository error"));

      // Act & Assert
      await expect(
        service.findByUser({
          query: {},
          userId: TEST_IDS.userId,
        }),
      ).rejects.toThrow("Repository error");
    });

    it("should handle empty results", async () => {
      // Arrange
      auditRepository.findByUser.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] } as any);

      // Act
      const result = await service.findByUser({
        query: {},
        userId: TEST_IDS.userId,
      });

      // Assert
      expect(result).toEqual({ data: [] });
    });
  });
});
