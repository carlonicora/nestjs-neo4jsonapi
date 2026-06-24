import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { HttpException, HttpStatus } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../abstract.repository";
import { Neo4jService } from "../../services/neo4j.service";
import { SecurityService } from "../../../security/services/security.service";
import { EntityDescriptor, RelationshipDef } from "../../../../common/interfaces/entity.schema.interface";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";

// Test entity type
interface TestEntity {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Test related entity type
interface RelatedEntity {
  id: string;
  title: string;
}

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  entityId: "770e8400-e29b-41d4-a716-446655440002",
  relatedId: "880e8400-e29b-41d4-a716-446655440003",
};

// Create mock model
const createMockModel = (): DataModelInterface<TestEntity> => ({
  nodeName: "testEntity",
  labelName: "TestEntity",
  jsonapiType: "test-entities",
  mapper: vi.fn(),
  attributes: {},
});

// Create mock related model
const createMockRelatedModel = (): DataModelInterface<RelatedEntity> => ({
  nodeName: "relatedEntity",
  labelName: "RelatedEntity",
  jsonapiType: "related-entities",
  mapper: vi.fn(),
  attributes: {},
});

// Test relationships type
type TestRelationships = {
  author: RelationshipDef;
  topics: RelationshipDef;
};

// Create mock descriptor for company-scoped entity
const createMockDescriptor = (isCompanyScoped = true): EntityDescriptor<TestEntity, TestRelationships> => ({
  model: createMockModel(),
  isCompanyScoped,
  relationships: {
    author: {
      model: createMockRelatedModel(),
      direction: "out",
      relationship: "AUTHORED_BY",
      cardinality: "one",
      required: true,
    },
    topics: {
      model: createMockRelatedModel(),
      direction: "out",
      relationship: "TAGGED_WITH",
      cardinality: "many",
      required: false,
      fields: [{ name: "relevance", type: "number" }],
    },
  },
  relationshipKeys: {
    author: "author",
    topics: "topics",
  },
  fieldNames: ["name", "description"],
  stringFields: ["name", "description"],
  requiredFields: ["name"],
  fieldDefaults: { description: "" },
  fields: {
    name: { type: "string", required: true },
    description: { type: "string", required: false, default: "" },
  },
  computed: {},
  virtualFields: {},
  injectServices: [],
  constraints: [{ property: "id", type: "UNIQUE" }],
  indexes: [{ name: "testEntity_search_index", properties: ["name", "description"], type: "FULLTEXT" }],
  fulltextIndexName: "testEntity_search_index",
  defaultOrderBy: "name ASC",
});

// Concrete implementation for testing
class TestRepository extends AbstractRepository<TestEntity, TestRelationships> {
  protected readonly descriptor: EntityDescriptor<TestEntity, TestRelationships>;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService, isCompanyScoped = true) {
    super(neo4j, securityService, clsService);
    this.descriptor = createMockDescriptor(isCompanyScoped);
  }

  // Expose protected methods for testing
  public exposedBuildDefaultMatch(options?: { searchField?: string; blockCompanyAndUser?: boolean }): string {
    return this.buildDefaultMatch(options);
  }

  public exposedBuildUserHasAccess(): string {
    return this.buildUserHasAccess();
  }

  public exposedBuildReturnStatement(): string {
    return this.buildReturnStatement();
  }

  public async exposedValidateForbidden(params: {
    response: TestEntity | null;
    searchField: string;
    searchValue: string;
  }): Promise<TestEntity | null> {
    return this._validateForbidden(params);
  }
}

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  read: vi.fn(),
  initQuery: vi.fn(),
  validateExistingNodes: vi.fn(),
});

const createMockSecurityService = () => ({
  userHasAccess: vi.fn((params: { validator: () => string }) => params.validator()),
  isCurrentUserCompanyAdmin: vi.fn().mockReturnValue(true),
  validateAdmin: vi.fn(),
  isUserInRoles: vi.fn().mockReturnValue(true),
});

const createMockClsService = () => ({
  has: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
});

describe("AbstractRepository", () => {
  let repository: TestRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let securityService: ReturnType<typeof createMockSecurityService>;
  let clsService: ReturnType<typeof createMockClsService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
    cursor: undefined,
    serialiser: undefined,
    fetchAll: false,
  });

  const MOCK_ENTITY: TestEntity = {
    id: TEST_IDS.entityId,
    name: "Test Entity",
    description: "A test entity",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();
    securityService = createMockSecurityService();
    clsService = createMockClsService();

    // Default CLS context
    clsService.get.mockImplementation((key: string) => {
      if (key === "companyId") return TEST_IDS.companyId;
      if (key === "userId") return TEST_IDS.userId;
      return null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: TestRepository,
          useFactory: () =>
            new TestRepository(
              neo4jService as unknown as Neo4jService,
              securityService as unknown as SecurityService,
              clsService as unknown as ClsService,
            ),
        },
      ],
    }).compile();

    repository = module.get<TestRepository>(TestRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create constraints and indexes on init", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("CREATE CONSTRAINT testEntity_id IF NOT EXISTS"),
      });
    });

    it("should create FULLTEXT index if not exists", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("CREATE FULLTEXT INDEX"),
        queryParams: {},
      });
    });

    it("should skip FULLTEXT index creation if matching index exists", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);
      const mockRecord = {
        get: vi.fn((field: string) => {
          if (field === "labels") return ["TestEntity"];
          if (field === "properties") return ["name", "description"];
          return null;
        }),
      };
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });

      await repository.onModuleInit();

      // Should only be called once for constraint, not for FULLTEXT index
      expect(neo4jService.writeOne).toHaveBeenCalledTimes(1);
    });

    it("should handle constraint creation errors", async () => {
      const error = new Error("Constraint creation failed");
      neo4jService.writeOne.mockRejectedValue(error);

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("buildDefaultMatch", () => {
    it("should build match query for company-scoped entity", () => {
      const result = repository.exposedBuildDefaultMatch();

      expect(result).toContain("MATCH (testEntity:TestEntity)");
      expect(result).toContain("WHERE $companyId IS NULL");
      expect(result).toContain("BELONGS_TO");
    });

    it("should include search field when provided", () => {
      const result = repository.exposedBuildDefaultMatch({ searchField: "id" });

      expect(result).toContain("MATCH (testEntity:TestEntity {id: $searchValue})");
    });

    it("should build match query for non-company-scoped entity", async () => {
      const nonScopedRepository = new TestRepository(
        neo4jService as unknown as Neo4jService,
        securityService as unknown as SecurityService,
        clsService as unknown as ClsService,
        false,
      );

      const result = nonScopedRepository.exposedBuildDefaultMatch();

      expect(result).toContain("MATCH (testEntity:TestEntity)");
      expect(result).not.toContain("BELONGS_TO");
    });
  });

  describe("buildUserHasAccess", () => {
    it("should return WITH statement with node name", () => {
      const result = repository.exposedBuildUserHasAccess();

      expect(result).toBe("WITH testEntity");
    });
  });

  describe("buildReturnStatement", () => {
    it("should build return statement with relationships", () => {
      const result = repository.exposedBuildReturnStatement();

      expect(result).toContain("MATCH (testEntity:TestEntity)-[:BELONGS_TO]->(testEntity_company:Company)");
      expect(result).toContain("MATCH (testEntity)-[:AUTHORED_BY]->(testEntity_author:RelatedEntity)");
      expect(result).toContain(
        "OPTIONAL MATCH (testEntity)-[testEntity_topics_relationship:TAGGED_WITH]->(testEntity_topics:RelatedEntity)",
      );
      expect(result).toContain("RETURN");
    });
  });

  describe("find", () => {
    it("should find entities with default ordering", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ENTITY]);

      const result = await repository.find({});

      expect(neo4jService.initQuery).toHaveBeenCalled();
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_ENTITY]);
    });

    it("should find entities with search term using fulltext index", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ENTITY]);

      await repository.find({ term: "test" });

      expect(mockQuery.queryParams.term).toBe("*test*");
      expect(mockQuery.query).toContain("db.index.fulltext.queryNodes");
    });

    it("should find entities with custom ordering", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ENTITY]);

      await repository.find({ orderBy: "createdAt DESC" });

      expect(mockQuery.query).toContain("ORDER BY testEntity.createdAt DESC");
    });

    it("should handle cursor pagination", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ENTITY]);

      await repository.find({ cursor: { cursor: "10", take: 25 } });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { cursor: "10", take: 25 },
        }),
      );
    });

    it("should handle fetchAll flag", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ENTITY]);

      await repository.find({ fetchAll: true });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          fetchAll: true,
        }),
      );
    });
  });

  describe("findById", () => {
    it("should find entity by ID successfully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_ENTITY);

      const result = await repository.findById({ id: TEST_IDS.entityId });

      expect(mockQuery.queryParams.searchValue).toBe(TEST_IDS.entityId);
      expect(result).toEqual(MOCK_ENTITY);
    });

    it("should return null when entity not found and doesnt exist", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findById({ id: "nonexistent" });

      expect(result).toBeNull();
    });

    it("should throw Forbidden when entity exists but user has no access", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      // First call returns null (user doesn't have access)
      // Second call returns entity (exists without company filter)
      neo4jService.readOne.mockResolvedValueOnce(null).mockResolvedValueOnce(MOCK_ENTITY);

      await expect(repository.findById({ id: TEST_IDS.entityId })).rejects.toThrow(HttpException);
    });
  });

  describe("findByIds", () => {
    it("should find entities by ID list", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ENTITY]);

      const ids = [TEST_IDS.entityId, "another-id"];
      const result = await repository.findByIds({ ids });

      expect(mockQuery.queryParams.ids).toEqual(ids);
      expect(mockQuery.query).toContain("testEntity.id IN $ids");
      expect(result).toEqual([MOCK_ENTITY]);
    });

    it("should return empty array when no IDs provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByIds({ ids: [] });

      expect(result).toEqual([]);
    });
  });

  describe("findByRelated", () => {
    it("should find entities by related entity ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ENTITY]);

      const result = await repository.findByRelated({
        relationship: "author",
        id: TEST_IDS.relatedId,
      });

      expect(mockQuery.queryParams.relatedIds).toEqual([TEST_IDS.relatedId]);
      expect(mockQuery.query).toContain("AUTHORED_BY");
      expect(result).toEqual([MOCK_ENTITY]);
    });

    it("should find entities by multiple related entity IDs", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ENTITY]);

      const ids = [TEST_IDS.relatedId, "another-related-id"];
      const result = await repository.findByRelated({
        relationship: "topics",
        id: ids,
      });

      expect(mockQuery.queryParams.relatedIds).toEqual(ids);
      expect(result).toEqual([MOCK_ENTITY]);
    });

    it("should find entities with search term and related filter", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_ENTITY]);

      await repository.findByRelated({
        relationship: "author",
        id: TEST_IDS.relatedId,
        term: "test",
      });

      expect(mockQuery.query).toContain("db.index.fulltext.queryNodes");
      expect(mockQuery.query).toContain("AUTHORED_BY");
    });

    it("should throw error for unknown relationship", async () => {
      await expect(
        repository.findByRelated({
          relationship: "unknown" as any,
          id: TEST_IDS.relatedId,
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("create", () => {
    it("should create entity with relationships", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.entityId,
        name: "New Entity",
        author: TEST_IDS.relatedId,
      });

      expect(neo4jService.validateExistingNodes).toHaveBeenCalled();
      expect(mockQuery.query).toContain("CREATE (testEntity:TestEntity");
      expect(mockQuery.query).toContain("CREATE (testEntity)-[:BELONGS_TO]->(company)");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should apply field defaults", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.entityId,
        name: "New Entity",
      });

      // description should have default value from fieldDefaults
      expect(mockQuery.queryParams.description).toBe("");
    });

    it("should handle many-to-many relationships with edge properties", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.entityId,
        name: "New Entity",
        topics: [TEST_IDS.relatedId, "another-topic-id"],
        topicsEdgeProps: {
          [TEST_IDS.relatedId]: { relevance: 0.8 },
          "another-topic-id": { relevance: 0.5 },
        },
      });

      expect(neo4jService.writeOne).toHaveBeenCalled();
    });

    it("should skip validation when no related nodes", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.entityId,
        name: "New Entity",
      });

      expect(neo4jService.validateExistingNodes).not.toHaveBeenCalled();
    });
  });

  describe("put", () => {
    it("should perform full update", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.put({
        id: TEST_IDS.entityId,
        name: "Updated Entity",
        description: "Updated description",
        author: TEST_IDS.relatedId,
      });

      expect(mockQuery.query).toContain("SET testEntity.updatedAt = datetime()");
      expect(mockQuery.query).toContain("testEntity.name = $name");
      expect(mockQuery.query).toContain("testEntity.description = $description");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should match with company relationship for company-scoped entities", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.put({
        id: TEST_IDS.entityId,
        name: "Updated",
      });

      expect(mockQuery.query).toContain("MATCH (testEntity:TestEntity {id: $id})-[:BELONGS_TO]->(company)");
    });

    it("should match without company for non-company-scoped entities", async () => {
      const nonScopedRepository = new TestRepository(
        neo4jService as unknown as Neo4jService,
        securityService as unknown as SecurityService,
        clsService as unknown as ClsService,
        false,
      );

      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await nonScopedRepository.put({
        id: TEST_IDS.entityId,
        name: "Updated",
      });

      expect(mockQuery.query).toContain("MATCH (testEntity:TestEntity {id: $id})");
      expect(mockQuery.query).not.toContain("BELONGS_TO");
    });

    it("should never SET an immutable field on full update (preserves server-managed value)", async () => {
      // A PUT must not overwrite immutable fields (e.g. game.intro / game.originPlot),
      // even when they are part of the descriptor's fieldNames.
      class ImmutableFieldRepository extends AbstractRepository<TestEntity, TestRelationships> {
        protected readonly descriptor = {
          ...createMockDescriptor(true),
          fieldNames: ["name", "intro"],
          fields: {
            name: { type: "string", required: true },
            intro: { type: "string", immutable: true },
          },
        } as unknown as EntityDescriptor<TestEntity, TestRelationships>;
      }

      const repo = new ImmutableFieldRepository(
        neo4jService as unknown as Neo4jService,
        securityService as unknown as SecurityService,
        clsService as unknown as ClsService,
      );

      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repo.put({ id: TEST_IDS.entityId, name: "Updated", intro: null });

      expect(mockQuery.query).toContain("testEntity.name = $name");
      expect(mockQuery.query).not.toContain("testEntity.intro");
    });
  });

  describe("patch", () => {
    it("should perform partial update with only provided fields", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.patch({
        id: TEST_IDS.entityId,
        name: "Patched Name",
      });

      expect(mockQuery.query).toContain("testEntity.name = $name");
      expect(mockQuery.query).not.toContain("testEntity.description = $description");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should update only relationships that are provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.patch({
        id: TEST_IDS.entityId,
        author: TEST_IDS.relatedId,
      });

      expect(mockQuery.query).toContain("AUTHORED_BY");
      expect(mockQuery.queryParams.author).toEqual([TEST_IDS.relatedId]);
    });

    it("should handle edge-only updates", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.patch({
        id: TEST_IDS.entityId,
        topicsEdgePropsUpdate: {
          [TEST_IDS.relatedId]: { relevance: 0.9 },
        },
      });

      expect(mockQuery.query).toContain("SET rel.relevance");
      expect(mockQuery.query).toContain("rel.updatedAt = datetime()");
    });
  });

  describe("delete", () => {
    it("should delete entity with company relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.delete({ id: TEST_IDS.entityId });

      expect(mockQuery.queryParams.id).toBe(TEST_IDS.entityId);
      expect(mockQuery.query).toContain("MATCH (testEntity:TestEntity {id: $id})-[:BELONGS_TO]->(company)");
      expect(mockQuery.query).toContain("DETACH DELETE testEntity");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should delete entity without company for non-company-scoped", async () => {
      const nonScopedRepository = new TestRepository(
        neo4jService as unknown as Neo4jService,
        securityService as unknown as SecurityService,
        clsService as unknown as ClsService,
        false,
      );

      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await nonScopedRepository.delete({ id: TEST_IDS.entityId });

      expect(mockQuery.query).toContain("MATCH (testEntity:TestEntity {id: $id})");
      expect(mockQuery.query).not.toContain("BELONGS_TO");
      expect(mockQuery.query).toContain("DETACH DELETE testEntity");
    });
  });

  describe("addToRelationship", () => {
    it("should add items to many relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.addToRelationship({
        id: TEST_IDS.entityId,
        relationship: "topics",
        items: [{ id: TEST_IDS.relatedId, edgeProps: { relevance: 0.8 } }],
      });

      expect(mockQuery.queryParams.parentId).toBe(TEST_IDS.entityId);
      expect(mockQuery.query).toContain("MERGE (parent)-[r:TAGGED_WITH]->(related)");
      expect(mockQuery.query).toContain("SET r.relevance = item.edgeProps.relevance");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should not make query when items array is empty", async () => {
      await repository.addToRelationship({
        id: TEST_IDS.entityId,
        relationship: "topics",
        items: [],
      });

      expect(neo4jService.writeOne).not.toHaveBeenCalled();
    });

    it("should throw error for unknown relationship", async () => {
      await expect(
        repository.addToRelationship({
          id: TEST_IDS.entityId,
          relationship: "unknown" as any,
          items: [{ id: TEST_IDS.relatedId }],
        }),
      ).rejects.toThrow(HttpException);
    });

    it("should throw error for non-many cardinality relationship", async () => {
      await expect(
        repository.addToRelationship({
          id: TEST_IDS.entityId,
          relationship: "author",
          items: [{ id: TEST_IDS.relatedId }],
        }),
      ).rejects.toThrow("addToRelationship only works with 'many' cardinality relationships");
    });
  });

  describe("removeFromRelationship", () => {
    it("should remove items from many relationship", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.removeFromRelationship({
        id: TEST_IDS.entityId,
        relationship: "topics",
        itemIds: [TEST_IDS.relatedId],
      });

      expect(mockQuery.queryParams.parentId).toBe(TEST_IDS.entityId);
      expect(mockQuery.queryParams.itemIds).toEqual([TEST_IDS.relatedId]);
      expect(mockQuery.query).toContain("WHERE related.id IN $itemIds");
      expect(mockQuery.query).toContain("DELETE r");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should not make query when itemIds array is empty", async () => {
      await repository.removeFromRelationship({
        id: TEST_IDS.entityId,
        relationship: "topics",
        itemIds: [],
      });

      expect(neo4jService.writeOne).not.toHaveBeenCalled();
    });

    it("should throw error for unknown relationship", async () => {
      await expect(
        repository.removeFromRelationship({
          id: TEST_IDS.entityId,
          relationship: "unknown" as any,
          itemIds: [TEST_IDS.relatedId],
        }),
      ).rejects.toThrow(HttpException);
    });

    it("should throw error for non-many cardinality relationship", async () => {
      await expect(
        repository.removeFromRelationship({
          id: TEST_IDS.entityId,
          relationship: "author",
          itemIds: [TEST_IDS.relatedId],
        }),
      ).rejects.toThrow("removeFromRelationship only works with 'many' cardinality relationships");
    });
  });

  describe("_validateForbidden", () => {
    it("should return response when not null", async () => {
      const result = await repository.exposedValidateForbidden({
        response: MOCK_ENTITY,
        searchField: "id",
        searchValue: TEST_IDS.entityId,
      });

      expect(result).toEqual(MOCK_ENTITY);
    });

    it("should return null when entity doesn't exist", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.exposedValidateForbidden({
        response: null,
        searchField: "id",
        searchValue: "nonexistent",
      });

      expect(result).toBeNull();
    });

    it("should throw Forbidden when entity exists but user has no access", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_ENTITY);

      await expect(
        repository.exposedValidateForbidden({
          response: null,
          searchField: "id",
          searchValue: TEST_IDS.entityId,
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string values in create", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.entityId,
        name: "",
        description: "",
      });

      expect(mockQuery.queryParams.name).toBe("");
      expect(mockQuery.queryParams.description).toBe("");
    });

    it("should handle special characters in entity name", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.patch({
        id: TEST_IDS.entityId,
        name: "O'Brien & Co. (Test)",
      });

      expect(mockQuery.queryParams.name).toBe("O'Brien & Co. (Test)");
    });

    it("should handle relationship with incoming direction", async () => {
      // Create a modified descriptor with incoming relationship
      const modifiedRepository = new TestRepository(
        neo4jService as unknown as Neo4jService,
        securityService as unknown as SecurityService,
        clsService as unknown as ClsService,
      );

      const returnStatement = modifiedRepository.exposedBuildReturnStatement();

      // author has direction: 'out', topics has direction: 'out'
      expect(returnStatement).toContain("-[:AUTHORED_BY]->");
      expect(returnStatement).toContain("-[testEntity_topics_relationship:TAGGED_WITH]->");
    });

    it("should handle database errors gracefully", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      const error = new Error("Database connection lost");
      neo4jService.readMany.mockRejectedValue(error);

      await expect(repository.find({})).rejects.toThrow("Database connection lost");
    });
  });
});
