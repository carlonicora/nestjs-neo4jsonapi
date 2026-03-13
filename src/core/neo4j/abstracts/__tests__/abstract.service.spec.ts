import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractService } from "../abstract.service";
import { AbstractRepository } from "../abstract.repository";
import { JsonApiService } from "../../../jsonapi/services/jsonapi.service";
import { AuditService } from "../../../../foundations/audit/services/audit.service";
import { EntityDescriptor, RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";

// Concrete implementation for testing
class TestEntity {
  id: string;
  name: string;
  status: string;
  company?: { id: string };
}

const testDescriptor = {
  fieldNames: ["name", "status"],
  fieldDefaults: {},
  relationships: {},
  fields: {},
  computed: {},
  virtualFields: {},
  isCompanyScoped: true,
  model: { type: "tests", endpoint: "tests", nodeName: "test", labelName: "Test" },
} as unknown as EntityDescriptor<TestEntity, Record<string, RelationshipDef>>;

const testModel = {
  type: "tests",
  endpoint: "tests",
  nodeName: "test",
  labelName: "Test",
} as DataModelInterface<TestEntity>;

class TestService extends AbstractService<TestEntity> {
  protected readonly descriptor = testDescriptor;
}

describe("AbstractService - Audit Integration", () => {
  let service: TestService;
  let repository: any;
  let jsonApiService: any;
  let clsService: any;
  let auditService: any;

  const TEST_IDS = {
    userId: "user-123",
    companyId: "company-456",
    entityId: "entity-789",
  };

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      find: vi.fn(),
    };

    jsonApiService = {
      buildSingle: vi.fn().mockReturnValue({ data: {} }),
      buildList: vi.fn(),
    };

    clsService = {
      get: vi.fn((key: string) => {
        const map: Record<string, string> = {
          userId: TEST_IDS.userId,
          companyId: TEST_IDS.companyId,
        };
        return map[key];
      }),
    };

    auditService = {
      logCreate: vi.fn(),
      logUpdate: vi.fn(),
      logDelete: vi.fn(),
      logRead: vi.fn(),
    };

    service = new TestService(jsonApiService, repository, clsService, testModel, auditService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("create with audit", () => {
    it("should call auditService.logCreate after repository.create", async () => {
      repository.create.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue({ id: TEST_IDS.entityId });

      await service.create({ id: TEST_IDS.entityId, name: "Test" });

      expect(repository.create).toHaveBeenCalled();
      expect(auditService.logCreate).toHaveBeenCalledWith({
        entityType: "Test",
        entityId: TEST_IDS.entityId,
      });
    });

    it("should not fail if auditService is undefined", async () => {
      const serviceWithoutAudit = new TestService(jsonApiService, repository, clsService, testModel);
      repository.create.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue({ id: TEST_IDS.entityId });

      await expect(serviceWithoutAudit.create({ id: TEST_IDS.entityId, name: "Test" })).resolves.toBeDefined();
    });
  });

  describe("put with audit", () => {
    it("should read before state and call auditService.logUpdate", async () => {
      const beforeEntity = { id: TEST_IDS.entityId, name: "Old", status: "draft" };
      repository.findById.mockResolvedValue(beforeEntity);
      repository.put.mockResolvedValue(undefined);

      await service.put({ id: TEST_IDS.entityId, name: "New", status: "sent" });

      expect(repository.findById).toHaveBeenCalledWith({ id: TEST_IDS.entityId });
      expect(auditService.logUpdate).toHaveBeenCalledWith({
        entityType: "Test",
        entityId: TEST_IDS.entityId,
        before: beforeEntity,
        after: { id: TEST_IDS.entityId, name: "New", status: "sent" },
        descriptor: testDescriptor,
      });
    });

    it("should not read before state if auditService is undefined", async () => {
      const serviceWithoutAudit = new TestService(jsonApiService, repository, clsService, testModel);
      repository.put.mockResolvedValue(undefined);
      repository.findById.mockResolvedValue({ id: TEST_IDS.entityId });

      await serviceWithoutAudit.put({ id: TEST_IDS.entityId, name: "New" });

      // findById called only once (for the return value), not for before-state
      expect(repository.findById).toHaveBeenCalledTimes(1);
    });
  });

  describe("patch with audit", () => {
    it("should read before state and call auditService.logUpdate", async () => {
      const beforeEntity = { id: TEST_IDS.entityId, name: "Old", status: "draft" };
      repository.findById.mockResolvedValue(beforeEntity);
      repository.patch.mockResolvedValue(undefined);

      await service.patch({ id: TEST_IDS.entityId, status: "sent" });

      expect(auditService.logUpdate).toHaveBeenCalledWith({
        entityType: "Test",
        entityId: TEST_IDS.entityId,
        before: beforeEntity,
        after: { id: TEST_IDS.entityId, status: "sent" },
        descriptor: testDescriptor,
      });
    });
  });

  describe("delete with audit", () => {
    it("should call auditService.logDelete with snapshot", async () => {
      const entity = { id: TEST_IDS.entityId, name: "Doomed", company: { id: TEST_IDS.companyId } };
      repository.findById.mockResolvedValue(entity);
      repository.delete.mockResolvedValue(undefined);

      await service.delete({ id: TEST_IDS.entityId });

      expect(auditService.logDelete).toHaveBeenCalledWith({
        entityType: "Test",
        entityId: TEST_IDS.entityId,
        snapshot: entity,
        descriptor: testDescriptor,
      });
    });

    it("should still throw NotFoundException if entity not found", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.delete({ id: TEST_IDS.entityId })).rejects.toThrow(NotFoundException);
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });

    it("should still throw ForbiddenException if company mismatch", async () => {
      const entity = { id: TEST_IDS.entityId, company: { id: "other-company" } };
      repository.findById.mockResolvedValue(entity);

      await expect(service.delete({ id: TEST_IDS.entityId })).rejects.toThrow(ForbiddenException);
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });
  });
});
