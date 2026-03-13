import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { AuditRepository } from "../audit.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { auditLogMeta } from "../../entities/audit.meta";
import { userMeta } from "../../../user/entities/user.meta";

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "mocked-uuid-12345"),
}));

const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  entityId: "880e8400-e29b-41d4-a716-446655440003",
};

const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  read: vi.fn(),
  initQuery: vi.fn(),
});

describe("AuditRepository", () => {
  let repository: AuditRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditRepository, { provide: Neo4jService, useValue: neo4jService }],
    }).compile();

    repository = module.get<AuditRepository>(AuditRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining(`CREATE CONSTRAINT ${auditLogMeta.nodeName}_id IF NOT EXISTS`),
      });
    });

    it("should create entity_type + entity_id index", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("audit_entity"),
      });
    });

    it("should create company_id + createdAt index", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("audit_timestamp"),
      });
    });
  });

  describe("createEntry", () => {
    it("should create AuditLog node with all fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createEntry({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        ipAddress: "192.168.1.1",
        action: "update",
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        fieldName: "status",
        oldValue: "draft",
        newValue: "sent",
      });

      expect(mockQuery.queryParams).toMatchObject({
        id: "mocked-uuid-12345",
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        ipAddress: "192.168.1.1",
        action: "update",
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        fieldName: "status",
        oldValue: "draft",
        newValue: "sent",
      });
      expect(mockQuery.query).toContain(`CREATE (${auditLogMeta.nodeName}:${auditLogMeta.labelName}`);
      expect(mockQuery.query).toContain("action: $action");
      expect(mockQuery.query).toContain("entity_type: $entityType");
      expect(mockQuery.query).toContain("entity_id: $entityId");
      expect(mockQuery.query).toContain("field_name: $fieldName");
      expect(mockQuery.query).toContain("old_value: $oldValue");
      expect(mockQuery.query).toContain("new_value: $newValue");
      expect(mockQuery.query).toContain("ip_address: $ipAddress");
      expect(mockQuery.query).toContain("company_id: $companyId");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should create PERFORMED relationship from User", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createEntry({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        ipAddress: "192.168.1.1",
        action: "create",
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        fieldName: null,
        oldValue: null,
        newValue: null,
      });

      expect(mockQuery.query).toContain(`MATCH (${userMeta.nodeName}:${userMeta.labelName} {id: $userId})`);
      expect(mockQuery.query).toContain(`CREATE (${userMeta.nodeName})-[:PERFORMED]->(${auditLogMeta.nodeName})`);
    });

    it("should use OPTIONAL MATCH + FOREACH for AUDITED relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createEntry({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        ipAddress: "192.168.1.1",
        action: "delete",
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        fieldName: null,
        oldValue: '{"name":"Test"}',
        newValue: null,
      });

      expect(mockQuery.query).toContain("OPTIONAL MATCH (audited {id: $entityId})");
      expect(mockQuery.query).toContain("FOREACH");
      expect(mockQuery.query).toContain("AUDITED");
    });

    it("should handle null field values for create action", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.createEntry({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        ipAddress: "192.168.1.1",
        action: "create",
        entityType: "Account",
        entityId: TEST_IDS.entityId,
        fieldName: null,
        oldValue: null,
        newValue: null,
      });

      expect(mockQuery.queryParams.fieldName).toBeNull();
      expect(mockQuery.queryParams.oldValue).toBeNull();
      expect(mockQuery.queryParams.newValue).toBeNull();
    });
  });

  describe("findByEntity", () => {
    it("should query by entity_type, entity_id, and company_id", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findByEntity({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        companyId: TEST_IDS.companyId,
      });

      expect(mockQuery.queryParams).toMatchObject({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        companyId: TEST_IDS.companyId,
      });
      expect(mockQuery.query).toContain("entity_type: $entityType");
      expect(mockQuery.query).toContain("entity_id: $entityId");
      expect(mockQuery.query).toContain("company_id: $companyId");
      expect(mockQuery.query).toContain("ORDER BY");
      expect(mockQuery.query).toContain("DESC");
    });

    it("should support cursor pagination", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const cursor = { cursor: "10", take: 25 };
      await repository.findByEntity({
        entityType: "Quote",
        entityId: TEST_IDS.entityId,
        companyId: TEST_IDS.companyId,
        cursor,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(expect.objectContaining({ cursor }));
    });
  });

  describe("findActivityByEntity", () => {
    it("should call neo4jService.read with UNION query and correct params", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.findActivityByEntity({
        entityType: "Account",
        entityId: "entity-123",
        companyId: "company-456",
      });

      expect(mockQuery.queryParams).toMatchObject({
        entityType: "Account",
        entityId: "entity-123",
        companyId: "company-456",
      });
    });

    it("should include both AuditLog and Annotation in query", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.findActivityByEntity({
        entityType: "Account",
        entityId: "entity-123",
        companyId: "company-456",
      });

      expect(mockQuery.query).toContain("AuditLog");
      expect(mockQuery.query).toContain("Annotation");
      expect(mockQuery.query).toContain("UNION ALL");
    });

    it("should return mapped records from raw result", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);

      const mockRecord = {
        toObject: () => ({
          id: "audit-1",
          kind: "audit",
          action: "create",
          field_name: null,
          old_value: null,
          new_value: null,
          content: null,
          annotation_id: null,
          createdAt: "2026-03-13T10:00:00Z",
          updatedAt: "2026-03-13T10:00:00Z",
          user_id: "user-1",
          user_name: "Carlo",
          user_avatar: null,
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });

      const result = await repository.findActivityByEntity({
        entityType: "Account",
        entityId: "entity-123",
        companyId: "company-456",
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "audit-1",
        kind: "audit",
        action: "create",
      });
    });

    it("should support cursor pagination", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.findActivityByEntity({
        entityType: "Account",
        entityId: "entity-123",
        companyId: "company-456",
        cursor: { cursor: 10, take: 26 },
      });

      expect(mockQuery.queryParams.cursor).toBe(10);
      expect(mockQuery.queryParams.take).toBe(26);
      expect(mockQuery.query).toContain("SKIP");
      expect(mockQuery.query).toContain("LIMIT");
    });
  });

  describe("findByUser", () => {
    it("should use PERFORMED relationship and AuditLog label", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findByUser({ userId: TEST_IDS.userId });

      expect(mockQuery.query).toContain(`[:PERFORMED]->(${auditLogMeta.nodeName}:${auditLogMeta.labelName})`);
      expect(mockQuery.query).toContain("ORDER BY");
    });
  });
});
