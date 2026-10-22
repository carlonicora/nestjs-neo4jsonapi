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

  // Immutable fields are server-managed (set by a worker / dedicated Cypher), never
  // by the client DTO. A PUT that omits them must NOT null them out. See game.intro /
  // game.originPlot: editing a game's name was wiping its generated opening.
  describe("mapDTOToParams - immutable fields", () => {
    const immutableDescriptor = {
      fieldNames: ["name", "intro"],
      fieldDefaults: {},
      relationships: {},
      fields: {
        name: { type: "string" },
        intro: { type: "string", immutable: true },
      },
      computed: {},
      virtualFields: {},
      isCompanyScoped: true,
      model: testModel,
    } as unknown as EntityDescriptor<TestEntity, Record<string, RelationshipDef>>;

    class ImmutableService extends AbstractService<TestEntity> {
      protected readonly descriptor = immutableDescriptor;
      public exposedMap(data: any, op: "create" | "put") {
        return (this as unknown as { mapDTOToParams(d: any, o: "create" | "put"): any }).mapDTOToParams(data, op);
      }
    }

    let svc: ImmutableService;
    beforeEach(() => {
      svc = new ImmutableService(jsonApiService, repository, clsService, testModel);
    });

    it("omits an immutable field on PUT when absent (preserves stored value)", () => {
      const params = svc.exposedMap({ id: TEST_IDS.entityId, attributes: { name: "New" } }, "put");
      expect(params).toEqual({ id: TEST_IDS.entityId, name: "New" });
      expect("intro" in params).toBe(false);
    });

    it("nulls a non-immutable field that is absent on PUT (unchanged behavior)", () => {
      const params = svc.exposedMap({ id: TEST_IDS.entityId, attributes: { intro: "ignored" } }, "put");
      expect(params.name).toBeNull();
    });

    it("ignores a client-supplied value for an immutable field on PUT", () => {
      const params = svc.exposedMap({ id: TEST_IDS.entityId, attributes: { name: "New", intro: "hacked" } }, "put");
      expect("intro" in params).toBe(false);
    });
  });

  // A client request (PUT or PATCH) must never rewrite what the descriptor declares
  // immutable, the owner taken from the request context, or the tenant edge.
  describe("client writes to immutable / server-assigned data", () => {
    const userMetaStub = { type: "users", endpoint: "users", nodeName: "user", labelName: "User" };
    const companyMetaStub = { type: "companies", endpoint: "companies", nodeName: "company", labelName: "Company" };
    const parentMetaStub = { type: "parents", endpoint: "parents", nodeName: "parent", labelName: "Parent" };
    const tagMetaStub = { type: "tags", endpoint: "tags", nodeName: "tag", labelName: "Tag" };

    const guardedDescriptor = {
      fieldNames: ["name", "intro"],
      fieldDefaults: {},
      fields: {
        name: { type: "string" },
        intro: { type: "string", immutable: true },
      },
      relationships: {
        owner: {
          model: userMetaStub,
          direction: "out",
          relationship: "CREATED_BY",
          cardinality: "one",
          contextKey: "userId",
          immutable: true,
        },
        creator: {
          model: userMetaStub,
          direction: "in",
          relationship: "CREATED",
          cardinality: "one",
          immutable: true,
        },
        parent: {
          model: parentMetaStub,
          direction: "out",
          relationship: "CHILD_OF",
          cardinality: "one",
          immutable: true,
        },
        company: {
          model: companyMetaStub,
          direction: "out",
          relationship: "BELONGS_TO",
          cardinality: "one",
        },
        tags: {
          model: tagMetaStub,
          direction: "out",
          relationship: "TAGGED_WITH",
          cardinality: "many",
        },
      },
      computed: {},
      virtualFields: {},
      isCompanyScoped: true,
      model: testModel,
    } as unknown as EntityDescriptor<TestEntity, Record<string, RelationshipDef>>;

    class GuardedService extends AbstractService<TestEntity> {
      protected readonly descriptor = guardedDescriptor;
    }

    const hostileBody = {
      type: "tests",
      id: TEST_IDS.entityId,
      attributes: { name: "Renamed", intro: "hacked" },
      relationships: {
        owner: { data: { type: "users", id: "attacker" } },
        creator: { data: { type: "users", id: "attacker" } },
        parent: { data: { type: "parents", id: "other-parent" } },
        company: { data: { type: "companies", id: "other-company" } },
        tags: { data: [{ type: "tags", id: "tag-1" }] },
      },
    };

    let svc: GuardedService;
    beforeEach(() => {
      svc = new GuardedService(jsonApiService, repository, clsService, testModel);
      repository.findById.mockResolvedValue({ id: TEST_IDS.entityId });
    });

    describe("PATCH", () => {
      it("ignores an immutable field", async () => {
        await svc.patchFromDTO({ data: hostileBody as any });
        expect("intro" in repository.patch.mock.calls[0][0]).toBe(false);
      });

      it("ignores an immutable relationship", async () => {
        await svc.patchFromDTO({ data: hostileBody as any });
        const params = repository.patch.mock.calls[0][0];
        expect("parent" in params).toBe(false);
        expect("creator" in params).toBe(false);
      });

      it("ignores the owner (contextKey) relationship", async () => {
        await svc.patchFromDTO({ data: hostileBody as any });
        expect("owner" in repository.patch.mock.calls[0][0]).toBe(false);
      });

      it("ignores the company BELONGS_TO relationship of a company-scoped entity", async () => {
        await svc.patchFromDTO({ data: hostileBody as any });
        expect("company" in repository.patch.mock.calls[0][0]).toBe(false);
      });

      it("still writes a mutable field and a mutable relationship", async () => {
        await svc.patchFromDTO({ data: hostileBody as any });
        expect(repository.patch).toHaveBeenCalledWith({
          id: TEST_IDS.entityId,
          name: "Renamed",
          tags: ["tag-1"],
        });
      });
    });

    describe("PUT", () => {
      it("ignores an immutable field", async () => {
        await svc.putFromDTO({ data: hostileBody as any });
        expect("intro" in repository.put.mock.calls[0][0]).toBe(false);
      });

      it("ignores an immutable relationship", async () => {
        await svc.putFromDTO({ data: hostileBody as any });
        const params = repository.put.mock.calls[0][0];
        expect("parent" in params).toBe(false);
        expect("creator" in params).toBe(false);
      });

      it("ignores the owner relationship (client value never reaches the repository)", async () => {
        await svc.putFromDTO({ data: hostileBody as any });
        expect("owner" in repository.put.mock.calls[0][0]).toBe(false);
      });

      it("still writes a mutable field", async () => {
        await svc.putFromDTO({ data: hostileBody as any });
        const params = repository.put.mock.calls[0][0];
        expect(params.name).toBe("Renamed");
        expect(params.tags).toEqual(["tag-1"]);
      });
    });
  });
});

// delete() gates on CLS auth + company ownership. For a descriptor with
// `isCompanyScoped: false` the repository never hydrates `entity.company`, so the
// ownership comparison must be skipped — otherwise every delete throws Forbidden.
describe("AbstractService - delete company-scope gate", () => {
  const TEST_IDS = {
    userId: "user-123",
    companyId: "company-456",
    entityId: "entity-789",
  };

  const genericDescriptor = {
    fieldNames: ["name", "status"],
    fieldDefaults: {},
    relationships: {},
    fields: {},
    computed: {},
    virtualFields: {},
    isCompanyScoped: false,
    model: { type: "tests", endpoint: "tests", nodeName: "test", labelName: "Test" },
  } as unknown as EntityDescriptor<TestEntity, Record<string, RelationshipDef>>;

  class GenericService extends AbstractService<TestEntity> {
    protected readonly descriptor = genericDescriptor;
  }

  let repository: any;
  let jsonApiService: any;

  const makeCls = (values: Record<string, string | undefined>) =>
    ({ get: vi.fn((key: string) => values[key]) }) as unknown as ClsService;

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn(),
      find: vi.fn(),
    };
    jsonApiService = {
      buildSingle: vi.fn().mockReturnValue({ data: {} }),
      buildList: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("company-scoped descriptor", () => {
    it("deletes when the CLS companyId matches the entity's company", async () => {
      repository.findById.mockResolvedValue({
        id: TEST_IDS.entityId,
        company: { id: TEST_IDS.companyId },
      });
      const service = new TestService(
        jsonApiService,
        repository,
        makeCls({ userId: TEST_IDS.userId, companyId: TEST_IDS.companyId }),
        testModel,
      );

      await expect(service.delete({ id: TEST_IDS.entityId })).resolves.toBeUndefined();
      expect(repository.delete).toHaveBeenCalledWith({ id: TEST_IDS.entityId });
    });

    it("throws ForbiddenException when the CLS companyId does not match", async () => {
      repository.findById.mockResolvedValue({
        id: TEST_IDS.entityId,
        company: { id: "other-company" },
      });
      const service = new TestService(
        jsonApiService,
        repository,
        makeCls({ userId: TEST_IDS.userId, companyId: TEST_IDS.companyId }),
        testModel,
      );

      await expect(service.delete({ id: TEST_IDS.entityId })).rejects.toThrow(ForbiddenException);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("throws ForbiddenException when there is no authenticated userId", async () => {
      repository.findById.mockResolvedValue({
        id: TEST_IDS.entityId,
        company: { id: TEST_IDS.companyId },
      });
      const service = new TestService(
        jsonApiService,
        repository,
        makeCls({ userId: undefined, companyId: TEST_IDS.companyId }),
        testModel,
      );

      await expect(service.delete({ id: TEST_IDS.entityId })).rejects.toThrow(ForbiddenException);
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  describe("non-company-scoped descriptor", () => {
    it("deletes with an authenticated userId even though entity.company is undefined", async () => {
      repository.findById.mockResolvedValue({ id: TEST_IDS.entityId });
      const service = new GenericService(
        jsonApiService,
        repository,
        makeCls({ userId: TEST_IDS.userId, companyId: TEST_IDS.companyId }),
        testModel,
      );

      await expect(service.delete({ id: TEST_IDS.entityId })).resolves.toBeUndefined();
      expect(repository.delete).toHaveBeenCalledWith({ id: TEST_IDS.entityId });
    });

    it("deletes regardless of the CLS companyId value", async () => {
      repository.findById.mockResolvedValue({ id: TEST_IDS.entityId });

      for (const companyId of [undefined, "", "any-other-company"]) {
        repository.delete.mockClear();
        const service = new GenericService(
          jsonApiService,
          repository,
          makeCls({ userId: TEST_IDS.userId, companyId }),
          testModel,
        );

        await expect(service.delete({ id: TEST_IDS.entityId })).resolves.toBeUndefined();
        expect(repository.delete).toHaveBeenCalledWith({ id: TEST_IDS.entityId });
      }
    });

    it("still throws ForbiddenException when there is no authenticated userId", async () => {
      repository.findById.mockResolvedValue({ id: TEST_IDS.entityId });
      const service = new GenericService(
        jsonApiService,
        repository,
        makeCls({ userId: undefined, companyId: TEST_IDS.companyId }),
        testModel,
      );

      await expect(service.delete({ id: TEST_IDS.entityId })).rejects.toThrow(ForbiddenException);
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });
});
