import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { TokenUsageRepository } from "../tokenusage.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { TokenUsageType } from "../../enums/tokenusage.type";
import { tokenUsageMeta } from "../../entities/tokenusage.meta";
import { TokenUsageDescriptor } from "../../entities/tokenusage";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  tokenUsageId: "770e8400-e29b-41d4-a716-446655440002",
  contentId: "880e8400-e29b-41d4-a716-446655440003",
  chunkId: "990e8400-e29b-41d4-a716-446655440004",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  initQuery: vi.fn(),
  // `AbstractRepository.onModuleInit` probes SHOW INDEXES before creating the
  // descriptor-derived FULLTEXT index.
  read: vi.fn().mockResolvedValue({ records: [] }),
});

const createMockSecurityService = () => ({
  userHasAccess: vi.fn().mockReturnValue(""),
});

const createMockClsService = () => ({
  get: vi.fn().mockReturnValue(undefined),
  set: vi.fn(),
});

describe("TokenUsageDescriptor", () => {
  it("serialises exactly the five token-usage attributes", () => {
    const serialised = Object.entries(TokenUsageDescriptor.fields)
      .filter(([, def]: [string, any]) => !def.excludeFromJsonApi && !def.meta)
      .map(([name]) => name)
      .sort();

    expect(serialised).toEqual(["cachedInputTokens", "cost", "inputTokens", "outputTokens", "tokenUsageType"]);
  });

  it("declares no relationships (the old TokenUsageModel had childrenTokens: [])", () => {
    expect(Object.keys(TokenUsageDescriptor.relationships).sort()).toEqual([]);
  });

  it("is company-scoped (old TokenUsageModel.singleChildrenTokens: [companyMeta.nodeName])", () => {
    expect(TokenUsageDescriptor.isCompanyScoped).toBe(true);
  });
});

describe("TokenUsageRepository", () => {
  let repository: TokenUsageRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenUsageRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: SecurityService, useValue: createMockSecurityService() },
        { provide: ClsService, useValue: createMockClsService() },
      ],
    }).compile();

    repository = module.get<TokenUsageRepository>(TokenUsageRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      // Emitted by the inherited AbstractRepository.onModuleInit from
      // TokenUsageDescriptor.constraints — byte-identical to the constraint this
      // repository used to declare by hand.
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: `CREATE CONSTRAINT ${tokenUsageMeta.nodeName}_id IF NOT EXISTS FOR (${tokenUsageMeta.nodeName}:${tokenUsageMeta.labelName}) REQUIRE ${tokenUsageMeta.nodeName}.id IS UNIQUE`,
      });
    });

    it("should use correct tokenUsageMeta values in constraint", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("tokenusage_id"),
      });
      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query: expect.stringContaining("TokenUsage"),
      });
    });

    it("should handle errors", async () => {
      neo4jService.writeOne.mockRejectedValue(new Error("Constraint creation failed"));

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("create", () => {
    it("should create a token usage record for GraphCreator", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.GraphCreator,
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.001,
        relationshipId: TEST_IDS.contentId,
        relationshipType: "Content",
      });

      expect(mockQuery.queryParams.id).toBe(TEST_IDS.tokenUsageId);
      expect(mockQuery.queryParams.tokenUsageType).toBe(TokenUsageType.GraphCreator);
      expect(mockQuery.queryParams.inputTokens).toBe(100);
      expect(mockQuery.queryParams.outputTokens).toBe(50);
      expect(mockQuery.queryParams.cost).toBe(0.001);
      expect(mockQuery.queryParams.relationshipId).toBe(TEST_IDS.contentId);
      expect(mockQuery.query).toContain("CREATE (tokenusage:TokenUsage");
      expect(mockQuery.query).toContain("id: $id");
      expect(mockQuery.query).toContain("tokenUsageType: $tokenUsageType");
      expect(mockQuery.query).toContain("inputTokens: $inputTokens");
      expect(mockQuery.query).toContain("outputTokens: $outputTokens");
      expect(mockQuery.query).toContain("cachedInputTokens: $cachedInputTokens");
      expect(mockQuery.query).toContain("cost: $cost");
      expect(mockQuery.query).toContain("createdAt: datetime()");
      expect(mockQuery.query).toContain("updatedAt: datetime()");
      expect(mockQuery.query).toContain("[:BELONGS_TO]->(company)");
      expect(mockQuery.query).toContain("[:TRIGGERED_BY]->(currentUser)");
      expect(mockQuery.query).toContain("MATCH (relEntity:Content {id: $relationshipId})");
      expect(mockQuery.query).toContain("[:USED_FOR]->(relEntity)");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });

    it("should create token usage for Summariser type", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.Summariser,
        inputTokens: 500,
        outputTokens: 200,
        relationshipId: TEST_IDS.chunkId,
        relationshipType: "Chunk",
      });

      expect(mockQuery.queryParams.tokenUsageType).toBe(TokenUsageType.Summariser);
      expect(mockQuery.query).toContain("MATCH (relEntity:Chunk {id: $relationshipId})");
    });

    it("should create token usage for Responder type", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.Responder,
        inputTokens: 1000,
        outputTokens: 500,
        relationshipId: TEST_IDS.contentId,
        relationshipType: "Conversation",
      });

      expect(mockQuery.queryParams.tokenUsageType).toBe(TokenUsageType.Responder);
      expect(mockQuery.query).toContain("MATCH (relEntity:Conversation {id: $relationshipId})");
    });

    it("should default cost to 0 when not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.Analyser,
        inputTokens: 100,
        outputTokens: 50,
        relationshipId: TEST_IDS.contentId,
        relationshipType: "Content",
      });

      expect(mockQuery.queryParams.cost).toBe(0);
    });

    it("should default cachedInputTokens to 0 when not provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.Analyser,
        inputTokens: 100,
        outputTokens: 50,
        relationshipId: TEST_IDS.contentId,
        relationshipType: "Content",
      });

      expect(mockQuery.queryParams.cachedInputTokens).toBe(0);
    });

    it("should persist the cached input tokens when provided", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.Responder,
        inputTokens: 1000,
        outputTokens: 50,
        cachedInputTokens: 300,
        relationshipId: TEST_IDS.contentId,
        relationshipType: "Content",
      });

      expect(mockQuery.queryParams.cachedInputTokens).toBe(300);
    });

    it("should handle zero tokens", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.Ethicist,
        inputTokens: 0,
        outputTokens: 0,
        relationshipId: TEST_IDS.contentId,
        relationshipType: "Content",
      });

      expect(mockQuery.queryParams.inputTokens).toBe(0);
      expect(mockQuery.queryParams.outputTokens).toBe(0);
    });

    it("should handle large token counts", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.Strategy,
        inputTokens: 100000,
        outputTokens: 50000,
        cost: 10.5,
        relationshipId: TEST_IDS.contentId,
        relationshipType: "Content",
      });

      expect(mockQuery.queryParams.inputTokens).toBe(100000);
      expect(mockQuery.queryParams.outputTokens).toBe(50000);
      expect(mockQuery.queryParams.cost).toBe(10.5);
    });

    it("should handle errors from Neo4jService", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockRejectedValue(new Error("Database error"));

      await expect(
        repository.create({
          id: TEST_IDS.tokenUsageId,
          tokenUsageType: TokenUsageType.GraphCreator,
          inputTokens: 100,
          outputTokens: 50,
          relationshipId: TEST_IDS.contentId,
          relationshipType: "Content",
        }),
      ).rejects.toThrow("Database error");
    });

    it("should handle CounterpartIdentificator type", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.CounterpartIdentificator,
        inputTokens: 200,
        outputTokens: 100,
        relationshipId: TEST_IDS.contentId,
        relationshipType: "Content",
      });

      expect(mockQuery.queryParams.tokenUsageType).toBe(TokenUsageType.CounterpartIdentificator);
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      const exactRelId = "987e6543-e21b-12d3-a456-426614174999";

      await repository.create({
        id: exactId,
        tokenUsageType: TokenUsageType.GraphCreator,
        inputTokens: 100,
        outputTokens: 50,
        relationshipId: exactRelId,
        relationshipType: "Content",
      });

      expect(mockQuery.queryParams.id).toBe(exactId);
      expect(mockQuery.queryParams.relationshipId).toBe(exactRelId);
    });

    it("should handle decimal cost values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.GraphCreator,
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.000001,
        relationshipId: TEST_IDS.contentId,
        relationshipType: "Content",
      });

      expect(mockQuery.queryParams.cost).toBe(0.000001);
    });

    it("should handle different relationship types", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.create({
        id: TEST_IDS.tokenUsageId,
        tokenUsageType: TokenUsageType.GraphCreator,
        inputTokens: 100,
        outputTokens: 50,
        relationshipId: TEST_IDS.contentId,
        relationshipType: "CustomEntity",
      });

      expect(mockQuery.query).toContain("MATCH (relEntity:CustomEntity {id: $relationshipId})");
    });
  });
});
