import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { AuditRepository } from "../audit.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { Audit } from "../../entities/audit.entity";
import { auditMeta } from "../../entities/audit.meta";
import { userMeta } from "../../../user/entities/user.meta";

// Mock crypto.randomUUID
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "mocked-uuid-12345"),
}));

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  auditId: "770e8400-e29b-41d4-a716-446655440002",
  entityId: "880e8400-e29b-41d4-a716-446655440003",
};

// Mock factory
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  initQuery: vi.fn(),
});

describe("AuditRepository", () => {
  let repository: AuditRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_AUDIT: Audit = {
    id: TEST_IDS.auditId,
    auditType: "VIEW",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    user: {
      id: TEST_IDS.userId,
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      language: "en",
    } as any,
    audited: {
      id: TEST_IDS.entityId,
      type: "Content",
    },
  };

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
        query: `CREATE CONSTRAINT ${auditMeta.nodeName}_id IF NOT EXISTS FOR (${auditMeta.nodeName}:${auditMeta.labelName}) REQUIRE ${auditMeta.nodeName}.id IS UNIQUE`,
      });
    });

    it("should handle constraint creation errors", async () => {
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("findByUser", () => {
    it("should find audits by user ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_AUDIT]);

      const result = await repository.findByUser({ userId: TEST_IDS.userId });

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(mockQuery.queryParams).toMatchObject({
        userId: TEST_IDS.userId,
      });
      expect(mockQuery.query).toContain(`MATCH (audit_user:${userMeta.labelName} {id: $userId})`);
      expect(mockQuery.query).toContain(`[:INITIATED]->(audit:${auditMeta.labelName})`);
      expect(mockQuery.query).toContain("OPTIONAL MATCH (audit)-[:AUDITED]->(audit_audited)");
      expect(mockQuery.query).toContain("RETURN audit, audit_user, audit_audited");
      expect(mockQuery.query).toContain("ORDER BY audit.createdAt DESC");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_AUDIT]);
    });

    it("should return empty array when user has no audits", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByUser({ userId: TEST_IDS.userId });

      expect(result).toEqual([]);
    });

    it("should support cursor pagination", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_AUDIT]);

      const cursor = { cursor: "10", take: 25 };
      await repository.findByUser({ userId: TEST_IDS.userId, cursor });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor,
        }),
      );
    });

    it("should handle database errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database connection error");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.findByUser({ userId: TEST_IDS.userId })).rejects.toThrow("Database connection error");
    });

    it("should include labels in return statement for audited entity", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_AUDIT]);

      await repository.findByUser({ userId: TEST_IDS.userId });

      expect(mockQuery.query).toContain("labels(audit_audited) as audit_audited_labels");
    });
  });

  describe("create", () => {
    it("should create audit entry successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const params = {
        userId: TEST_IDS.userId,
        entityType: "Content",
        entityId: TEST_IDS.entityId,
        auditType: "VIEW",
      };

      await repository.create(params);

      expect(neo4jService.initQuery).toHaveBeenCalledWith();
      expect(mockQuery.queryParams).toMatchObject({
        id: "mocked-uuid-12345",
        userId: params.userId,
        entityId: params.entityId,
        auditType: params.auditType,
      });
      expect(mockQuery.query).toContain(`MATCH (${userMeta.nodeName}:${userMeta.labelName} {id: $userId})`);
      expect(mockQuery.query).toContain(`MATCH (audited:${params.entityType} {id: $entityId})`);
      expect(mockQuery.query).toContain(`CREATE (${auditMeta.nodeName}:${auditMeta.labelName}`);
      expect(mockQuery.query).toContain("id: $id");
      expect(mockQuery.query).toContain("auditType: $auditType");
      expect(mockQuery.query).toContain("createdAt: datetime()");
      expect(mockQuery.query).toContain("updatedAt: datetime()");
      expect(mockQuery.query).toContain(`CREATE (${userMeta.nodeName})-[:INITIATED]->(${auditMeta.nodeName})`);
      expect(mockQuery.query).toContain(`CREATE (${auditMeta.nodeName})-[:AUDITED]->(audited)`);
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should handle different entity types", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const params = {
        userId: TEST_IDS.userId,
        entityType: "Glossary",
        entityId: TEST_IDS.entityId,
        auditType: "CREATE",
      };

      await repository.create(params);

      expect(mockQuery.query).toContain("MATCH (audited:Glossary {id: $entityId})");
    });

    it("should handle different audit types", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const auditTypes = ["VIEW", "CREATE", "UPDATE", "DELETE", "EXPORT"];

      for (const auditType of auditTypes) {
        vi.clearAllMocks();
        neo4jService.initQuery.mockReturnValue(createMockQuery());
        neo4jService.writeOne.mockResolvedValue(undefined);

        await repository.create({
          userId: TEST_IDS.userId,
          entityType: "Content",
          entityId: TEST_IDS.entityId,
          auditType,
        });

        expect(neo4jService.writeOne).toHaveBeenCalled();
      }
    });

    it("should handle creation errors", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Creation failed - user not found");
      neo4jService.writeOne.mockRejectedValue(error);

      const params = {
        userId: "nonexistent",
        entityType: "Content",
        entityId: TEST_IDS.entityId,
        auditType: "VIEW",
      };

      await expect(repository.create(params)).rejects.toThrow("Creation failed - user not found");
    });

    it("should generate unique ID using randomUUID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        userId: TEST_IDS.userId,
        entityType: "Content",
        entityId: TEST_IDS.entityId,
        auditType: "VIEW",
      });

      expect(mockQuery.queryParams.id).toBe("mocked-uuid-12345");
    });

    it("should store changes field when provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const changesJson = JSON.stringify({ attributes: { name: "New Warehouse" } });

      await repository.create({
        userId: TEST_IDS.userId,
        entityType: "Content",
        entityId: TEST_IDS.entityId,
        auditType: "create",
        changes: changesJson,
      });

      expect(mockQuery.queryParams.changes).toBe(changesJson);
      expect(mockQuery.query).toContain("changes: $changes");
    });

    it("should store null changes when not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        userId: TEST_IDS.userId,
        entityType: "Content",
        entityId: TEST_IDS.entityId,
        auditType: "VIEW",
      });

      expect(mockQuery.queryParams.changes).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_AUDIT]);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";

      await repository.findByUser({ userId: exactId });

      expect(mockQuery.queryParams.userId).toBe(exactId);
    });

    it("should handle special characters in entity type", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const params = {
        userId: TEST_IDS.userId,
        entityType: "ContentVersion",
        entityId: TEST_IDS.entityId,
        auditType: "VIEW",
      };

      await repository.create(params);

      expect(mockQuery.query).toContain("MATCH (audited:ContentVersion {id: $entityId})");
    });

    it("should order results by createdAt DESC", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_AUDIT]);

      await repository.findByUser({ userId: TEST_IDS.userId });

      expect(mockQuery.query).toContain("ORDER BY audit.createdAt DESC");
    });
  });

  describe("Service Integration", () => {
    it("should call Neo4jService.initQuery before each read operation", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_AUDIT]);

      await repository.findByUser({ userId: TEST_IDS.userId });

      expect(neo4jService.initQuery).toHaveBeenCalledTimes(1);
    });

    it("should call Neo4jService.writeOne for create operation", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        userId: TEST_IDS.userId,
        entityType: "Content",
        entityId: TEST_IDS.entityId,
        auditType: "VIEW",
      });

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(1);
    });
  });
});
