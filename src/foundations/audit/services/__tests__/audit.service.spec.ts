import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { AuditService } from "../audit.service";
import { AuditRepository } from "../../repositories/audit.repository";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { EntityDescriptor, RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";

describe("AuditService", () => {
  let service: AuditService;
  let auditRepository: MockedObject<AuditRepository>;
  let jsonApiService: MockedObject<JsonApiService>;
  let clsService: MockedObject<ClsService>;

  const TEST_IDS = {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    entityId: "770e8400-e29b-41d4-a716-446655440002",
  };

  const TEST_IP = "192.168.1.1";

  const createMockAuditRepository = () => ({
    createEntry: vi.fn(),
    findByEntity: vi.fn(),
    findByUser: vi.fn(),
  });

  const createMockJsonApiService = () => ({
    buildList: vi.fn(),
    buildSingle: vi.fn(),
    buildError: vi.fn(),
  });

  const createMockClsService = () => ({
    get: vi.fn((key: string) => {
      const map: Record<string, string> = {
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        ipAddress: TEST_IP,
      };
      return map[key];
    }),
    set: vi.fn(),
    run: vi.fn(),
  });

  const createMockDescriptor = (
    fieldNames: string[] = ["name", "status"],
    relationships: Record<string, RelationshipDef> = {},
  ) =>
    ({
      fieldNames,
      relationships,
    }) as unknown as EntityDescriptor<any, any>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: AuditRepository, useValue: createMockAuditRepository() },
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: ClsService, useValue: createMockClsService() },
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

  describe("logCreate", () => {
    it("should create single audit entry with action 'create'", async () => {
      auditRepository.createEntry.mockResolvedValue(undefined);

      await service.logCreate({ entityType: "Quote", entityId: TEST_IDS.entityId });

      expect(auditRepository.createEntry).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        ipAddress: TEST_IP,
        action: "create",
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        fieldName: null,
        oldValue: null,
        newValue: null,
      });
    });

    it("should not create entry when userId is not available", async () => {
      clsService.get.mockReturnValue(undefined);

      await service.logCreate({ entityType: "Quote", entityId: TEST_IDS.entityId });

      expect(auditRepository.createEntry).not.toHaveBeenCalled();
    });
  });

  describe("logRead", () => {
    it("should create single audit entry with action 'read'", async () => {
      auditRepository.createEntry.mockResolvedValue(undefined);

      await service.logRead({ entityType: "Quote", entityId: TEST_IDS.entityId });

      expect(auditRepository.createEntry).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        ipAddress: TEST_IP,
        action: "read",
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        fieldName: null,
        oldValue: null,
        newValue: null,
      });
    });
  });

  describe("logDelete", () => {
    it("should create single audit entry with snapshot in old_value", async () => {
      auditRepository.createEntry.mockResolvedValue(undefined);
      const descriptor = createMockDescriptor(["name", "status"]);
      const snapshot = { name: "Test Quote", status: "draft" };

      await service.logDelete({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        snapshot,
        descriptor,
      });

      expect(auditRepository.createEntry).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        ipAddress: TEST_IP,
        action: "delete",
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        fieldName: null,
        oldValue: JSON.stringify({ name: "Test Quote", status: "draft" }),
        newValue: null,
      });
    });
  });

  describe("logUpdate", () => {
    it("should create one entry per changed field", async () => {
      auditRepository.createEntry.mockResolvedValue(undefined);
      const descriptor = createMockDescriptor(["name", "status"]);
      const before = { name: "Old Name", status: "draft" };
      const after = { id: TEST_IDS.entityId, name: "New Name", status: "sent" };

      await service.logUpdate({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        before,
        after,
        descriptor,
      });

      expect(auditRepository.createEntry).toHaveBeenCalledTimes(2);
      expect(auditRepository.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "update",
          fieldName: "name",
          oldValue: "Old Name",
          newValue: "New Name",
        }),
      );
      expect(auditRepository.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "status_change",
          fieldName: "status",
          oldValue: "draft",
          newValue: "sent",
        }),
      );
    });

    it("should use 'status_change' action for status field", async () => {
      auditRepository.createEntry.mockResolvedValue(undefined);
      const descriptor = createMockDescriptor(["status"]);
      const before = { status: "draft" };
      const after = { id: TEST_IDS.entityId, status: "sent" };

      await service.logUpdate({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        before,
        after,
        descriptor,
      });

      expect(auditRepository.createEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "status_change" }));
    });

    it("should skip unchanged fields", async () => {
      auditRepository.createEntry.mockResolvedValue(undefined);
      const descriptor = createMockDescriptor(["name", "status"]);
      const before = { name: "Same Name", status: "draft" };
      const after = { id: TEST_IDS.entityId, name: "Same Name", status: "sent" };

      await service.logUpdate({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        before,
        after,
        descriptor,
      });

      expect(auditRepository.createEntry).toHaveBeenCalledTimes(1);
      expect(auditRepository.createEntry).toHaveBeenCalledWith(expect.objectContaining({ fieldName: "status" }));
    });

    it("should not create entries when nothing changed", async () => {
      const descriptor = createMockDescriptor(["name"]);
      const before = { name: "Same" };
      const after = { id: TEST_IDS.entityId, name: "Same" };

      await service.logUpdate({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        before,
        after,
        descriptor,
      });

      expect(auditRepository.createEntry).not.toHaveBeenCalled();
    });

    it("should track relationship changes for 'one' cardinality", async () => {
      auditRepository.createEntry.mockResolvedValue(undefined);
      const descriptor = createMockDescriptor([], {
        owner: {
          model: { type: "users", endpoint: "users", nodeName: "user", labelName: "User" },
          direction: "in",
          relationship: "CREATED",
          cardinality: "one",
        },
      });
      const before = { owner: { id: "user-a" } };
      const after = { id: TEST_IDS.entityId, owner: "user-b" };

      await service.logUpdate({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        before,
        after,
        descriptor,
      });

      expect(auditRepository.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fieldName: "owner",
          oldValue: "user-a",
          newValue: "user-b",
        }),
      );
    });

    it("should stringify non-string values", async () => {
      auditRepository.createEntry.mockResolvedValue(undefined);
      const descriptor = createMockDescriptor(["count"]);
      const before = { count: 5 };
      const after = { id: TEST_IDS.entityId, count: 10 };

      await service.logUpdate({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        before,
        after,
        descriptor,
      });

      expect(auditRepository.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          oldValue: "5",
          newValue: "10",
        }),
      );
    });
  });

  describe("findByEntity", () => {
    it("should build paginated JSON:API response", async () => {
      auditRepository.findByEntity.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] } as any);

      await service.findByEntity({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        query: {},
      });

      expect(auditRepository.findByEntity).toHaveBeenCalledWith({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        companyId: TEST_IDS.companyId,
        cursor: expect.anything(),
      });
      expect(jsonApiService.buildList).toHaveBeenCalled();
    });
  });

  describe("findByUser", () => {
    it("should find audit entries by user with pagination", async () => {
      auditRepository.findByUser.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] } as any);

      const result = await service.findByUser({ query: {}, userId: TEST_IDS.userId });

      expect(auditRepository.findByUser).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        cursor: expect.anything(),
      });
      expect(result).toEqual({ data: [] });
    });
  });
});
