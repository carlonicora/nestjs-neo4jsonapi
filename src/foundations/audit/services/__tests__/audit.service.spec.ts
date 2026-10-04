import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { AuditService } from "../audit.service";
import { AuditRepository } from "../../repositories/audit.repository";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { EntityDescriptor, RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";
import { SystemRoles } from "../../../../common/constants/system.roles";
import { SYSTEM_ROLES } from "../../../../common/tokens";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";

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
  const OTHER_ROLE = "aaaaaaaa-0000-0000-0000-000000000000";

  let clsValues: Record<string, unknown>;
  let logger: { error: ReturnType<typeof vi.fn> };

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
    get: vi.fn((key: string) => clsValues[key] as any),
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
    clsValues = {
      userId: TEST_IDS.userId,
      companyId: TEST_IDS.companyId,
      ipAddress: TEST_IP,
      roles: [OTHER_ROLE],
    };
    logger = { error: vi.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: AuditRepository, useValue: createMockAuditRepository() },
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: ClsService, useValue: createMockClsService() },
        { provide: AppLoggingService, useValue: logger },
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
  describe("system administrators are never audited", () => {
    const descriptor = createMockDescriptor(["name"]);
    const calls: Array<[string, (s: AuditService) => Promise<void>]> = [
      ["logCreate", (s) => s.logCreate({ entityType: "Quote", entityId: TEST_IDS.entityId })],
      ["logRead", (s) => s.logRead({ entityType: "Quote", entityId: TEST_IDS.entityId })],
      [
        "logUpdate",
        (s) =>
          s.logUpdate({
            entityType: "Quote",
            entityId: TEST_IDS.entityId,
            before: { name: "a" },
            after: { name: "b" },
            descriptor,
          }),
      ],
      [
        "logDelete",
        (s) => s.logDelete({ entityType: "Quote", entityId: TEST_IDS.entityId, snapshot: { name: "a" }, descriptor }),
      ],
    ];

    it.each(calls)("%s does nothing for an Administrator", async (_name, call) => {
      clsValues.roles = [SystemRoles.Administrator];
      clsValues.companyId = undefined;

      await call(service);

      expect(auditRepository.createEntry).not.toHaveBeenCalled();
    });

    it.each(calls)("%s still audits a non-admin user", async (_name, call) => {
      auditRepository.createEntry.mockResolvedValue(undefined);
      clsValues.roles = [SystemRoles.CompanyAdministrator, OTHER_ROLE];

      await call(service);

      expect(auditRepository.createEntry).toHaveBeenCalledTimes(1);
      expect(auditRepository.createEntry).toHaveBeenCalledWith(expect.objectContaining({ userId: TEST_IDS.userId }));
    });

    it.each(calls)("%s still audits when no roles are in context", async (_name, call) => {
      auditRepository.createEntry.mockResolvedValue(undefined);
      clsValues.roles = undefined;

      await call(service);

      expect(auditRepository.createEntry).toHaveBeenCalledTimes(1);
    });

    it("uses the SYSTEM_ROLES provider when the application binds one", async () => {
      const customAdmin = "custom-admin-role";
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuditService,
          { provide: AuditRepository, useValue: createMockAuditRepository() },
          { provide: JsonApiService, useValue: createMockJsonApiService() },
          { provide: ClsService, useValue: createMockClsService() },
          { provide: SYSTEM_ROLES, useValue: { Administrator: customAdmin } },
        ],
      }).compile();
      const customService = module.get<AuditService>(AuditService);
      const repo = module.get(AuditRepository) as MockedObject<AuditRepository>;
      clsValues.roles = [customAdmin];

      await customService.logRead({ entityType: "Quote", entityId: TEST_IDS.entityId });

      expect(repo.createEntry).not.toHaveBeenCalled();
    });
  });

  describe("failure handling", () => {
    const descriptor = createMockDescriptor(["name"]);
    const calls: Array<[string, (s: AuditService) => Promise<void>]> = [
      ["logCreate", (s) => s.logCreate({ entityType: "Quote", entityId: TEST_IDS.entityId })],
      ["logRead", (s) => s.logRead({ entityType: "Quote", entityId: TEST_IDS.entityId })],
      [
        "logUpdate",
        (s) =>
          s.logUpdate({
            entityType: "Quote",
            entityId: TEST_IDS.entityId,
            before: { name: "a" },
            after: { name: "b" },
            descriptor,
          }),
      ],
      [
        "logDelete",
        (s) => s.logDelete({ entityType: "Quote", entityId: TEST_IDS.entityId, snapshot: { name: "a" }, descriptor }),
      ],
    ];

    it.each(calls)("%s resolves and logs when the write fails", async (_name, call) => {
      const error = new Error("Expected parameter(s): companyId");
      auditRepository.createEntry.mockRejectedValue(error);

      await expect(call(service)).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Audit"), error, "AuditService");
    });

    it("passes companyId as null when the user has no company", async () => {
      auditRepository.createEntry.mockResolvedValue(undefined);
      clsValues.companyId = undefined;

      await service.logRead({ entityType: "Quote", entityId: TEST_IDS.entityId });

      expect(auditRepository.createEntry).toHaveBeenCalledWith(expect.objectContaining({ companyId: null }));
    });
  });
});
