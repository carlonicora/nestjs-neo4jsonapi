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
  it("serialises exactly the eight token-usage attributes", () => {
    const serialised = Object.entries(TokenUsageDescriptor.fields)
      .filter(([, def]: [string, any]) => !def.excludeFromJsonApi && !def.meta)
      .map(([name]) => name)
      .sort();

    // `model` and `provider` record WHICH model served the call. They are on the
    // JSON:API surface deliberately: a usage record that cannot say what produced
    // it is unauditable, and comparing the cost of two models is impossible
    // without it (every record would have to be attributed by timestamp guesswork).
    expect(serialised).toEqual([
      "cachedInputTokens",
      "cost",
      "credits",
      "inputTokens",
      "model",
      "outputTokens",
      "provider",
      "tokenUsageType",
    ]);
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

  // `queryParams` mirrors what Neo4jService.initQuery() actually returns: it always
  // sets companyId/currentUserId, and binds the matching `company` / `currentUser`
  // Cypher variables ONLY when the id is present. Tests asserting on a CLS-bound
  // write must pass the ids in explicitly.
  const createMockQuery = (queryParams: Record<string, any> = {}) => ({
    query: "",
    queryParams,
  });

  /** Arms the Neo4j double with a query whose CLS-derived ids are exactly as given. */
  const makeRepository = (queryParams: { companyId: string | null; currentUserId: string | null }) => {
    const query = createMockQuery({ ...queryParams });
    neo4jService.initQuery.mockReturnValue(query);
    neo4jService.writeOne.mockResolvedValue(undefined);
    return { repository, query, neo4j: neo4jService };
  };

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
      // Both ids bound: initQuery() emits the `company` and `currentUser` MATCHes,
      // so both edges have real nodes to attach to.
      const mockQuery = createMockQuery({ companyId: TEST_IDS.companyId, currentUserId: TEST_IDS.userId });
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

  describe("create() edge guards", () => {
    it("emits both edges when company and user are bound", async () => {
      const { repository, query } = makeRepository({ companyId: "c1", currentUserId: "u1" });

      await repository.create({
        id: "t1",
        tokenUsageType: "summariser",
        inputTokens: 1,
        outputTokens: 1,
        relationshipId: "r1",
        relationshipType: "Document",
      });

      expect(query.query).toContain("-[:BELONGS_TO]->(company)");
      expect(query.query).toContain("-[:TRIGGERED_BY]->(currentUser)");
    });

    it("omits the company edge when companyId is absent — corpus work has no customer", async () => {
      const { repository, query } = makeRepository({ companyId: null, currentUserId: "u1" });

      await repository.create({
        id: "t2",
        tokenUsageType: "massima_extraction",
        inputTokens: 1,
        outputTokens: 1,
        relationshipId: "r1",
        relationshipType: "Judgement",
      });

      expect(query.query).not.toContain("-[:BELONGS_TO]->(company)");
      expect(query.query).toContain("-[:TRIGGERED_BY]->(currentUser)");
    });

    it("omits both edges when neither id is bound", async () => {
      const { repository, query } = makeRepository({ companyId: null, currentUserId: null });

      await repository.create({
        id: "t3",
        tokenUsageType: "massima_extraction",
        inputTokens: 1,
        outputTokens: 1,
        relationshipId: "r1",
        relationshipType: "Judgement",
      });

      expect(query.query).not.toContain("-[:BELONGS_TO]->(company)");
      expect(query.query).not.toContain("-[:TRIGGERED_BY]->(currentUser)");
    });
  });

  describe("onModuleInit()", () => {
    it("creates the createdAt range index the date-ranged finders depend on", async () => {
      const { repository, neo4j } = makeRepository({ companyId: "c1", currentUserId: "u1" });

      await repository.onModuleInit();

      const queries = neo4j.writeOne.mock.calls.map((c: any[]) => c[0].query);
      expect(
        queries.some((q: string) =>
          q.includes(
            "CREATE INDEX tokenusage_createdAt IF NOT EXISTS FOR (tokenusage:TokenUsage) ON (tokenusage.createdAt)",
          ),
        ),
      ).toBe(true);
    });

    it("still creates the inherited id constraint — super.onModuleInit() must be called first", async () => {
      const { repository, neo4j } = makeRepository({ companyId: "c1", currentUserId: "u1" });

      await repository.onModuleInit();

      const queries = neo4j.writeOne.mock.calls.map((c: any[]) => c[0].query);
      expect(queries.some((q: string) => q.includes("CREATE CONSTRAINT tokenusage_id"))).toBe(true);
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

  describe("findByCompany", () => {
    const mockTokenUsage = {
      id: TEST_IDS.tokenUsageId,
      tokenUsageType: TokenUsageType.Analyser,
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.01,
      credits: 2.5,
    };

    it("should find token usage by company", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.readMany.mockResolvedValue([mockTokenUsage]);

      const result = await repository.findByCompany({});

      expect(result).toEqual([mockTokenUsage]);
    });

    it("should filter by start date", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([mockTokenUsage]);

      await repository.findByCompany({ startDate: "2024-01-01" });

      expect(mockQuery.queryParams.startDate).toBe("2024-01-01");
      expect(mockQuery.query).toContain("createdAt >= datetime($startDate)");
    });

    it("should filter by end date", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([mockTokenUsage]);

      await repository.findByCompany({ endDate: "2024-12-31" });

      expect(mockQuery.queryParams.endDate).toBe("2024-12-31");
      expect(mockQuery.query).toContain("createdAt <= datetime($endDate)");
    });

    it("should filter by token usage type", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([mockTokenUsage]);

      await repository.findByCompany({ tokenUsageType: TokenUsageType.Analyser });

      expect(mockQuery.queryParams.tokenUsageType).toBe(TokenUsageType.Analyser);
    });

    it("should paginate with the {CURSOR} placeholder", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findByCompany({});

      expect(mockQuery.query).toContain("{CURSOR}");
    });

    it("should handle empty results", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByCompany({});

      expect(result).toEqual([]);
    });
  });

  describe("findAggregatedByDateAndType", () => {
    it("should return aggregated data", async () => {
      const mockRecords = [
        {
          get: vi.fn((key: string) => {
            const data: Record<string, unknown> = {
              date: "2024-01-01",
              tokenUsageType: TokenUsageType.Analyser,
              totalCredits: 10.25,
              totalInputTokens: 1000,
              totalOutputTokens: 500,
              totalCost: 0.1,
              count: 5,
            };
            return data[key];
          }),
        },
      ];

      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.read.mockResolvedValue({ records: mockRecords });

      const result = await repository.findAggregatedByDateAndType({});

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2024-01-01");
      expect(result[0].totalCredits).toBe(10.25);
    });

    it("should sum credits as a rounded float, not pages as an integer", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.findAggregatedByDateAndType({});

      expect(mockQuery.query).toContain("round(sum(toFloat(tokenusage.credits)), 4) as totalCredits");
      expect(mockQuery.query).not.toContain("totalPages");
    });

    it("should filter by start date", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.findAggregatedByDateAndType({ startDate: "2024-01-01" });

      expect(mockQuery.queryParams.startDate).toBe("2024-01-01");
    });

    it("should filter by end date", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.findAggregatedByDateAndType({ endDate: "2024-12-31" });

      expect(mockQuery.queryParams.endDate).toBe("2024-12-31");
    });

    it("should handle empty results", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.read.mockResolvedValue({ records: [] });

      const result = await repository.findAggregatedByDateAndType({});

      expect(result).toEqual([]);
    });
  });

  describe("findUsageSummary", () => {
    it("should return usage summary", async () => {
      const mockRecord = {
        get: vi.fn((key: string) => {
          const data: Record<string, unknown> = {
            totalCredits: 100.5,
            totalInputTokens: 10000,
            totalOutputTokens: 5000,
            totalCost: 1.0,
            count: 50,
          };
          return data[key];
        }),
      };

      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.read.mockResolvedValue({ records: [mockRecord] });

      const result = await repository.findUsageSummary({});

      expect(result.totalCredits).toBe(100.5);
      expect(result.totalInputTokens).toBe(10000);
      expect(result.totalOutputTokens).toBe(5000);
      expect(result.totalCost).toBe(1.0);
      expect(result.count).toBe(50);
    });

    it("should sum credits as a rounded float, not pages as an integer", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.findUsageSummary({});

      expect(mockQuery.query).toContain("round(sum(toFloat(tokenusage.credits)), 4) as totalCredits");
      expect(mockQuery.query).not.toContain("totalPages");
    });

    it("should return zeros when no records", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.read.mockResolvedValue({ records: [] });

      const result = await repository.findUsageSummary({});

      expect(result.totalCredits).toBe(0);
      expect(result.totalInputTokens).toBe(0);
      expect(result.totalOutputTokens).toBe(0);
      expect(result.totalCost).toBe(0);
      expect(result.count).toBe(0);
    });

    it("should filter by start date", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.findUsageSummary({ startDate: "2024-01-01" });

      expect(mockQuery.queryParams.startDate).toBe("2024-01-01");
    });

    it("should filter by end date", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.read.mockResolvedValue({ records: [] });

      await repository.findUsageSummary({ endDate: "2024-12-31" });

      expect(mockQuery.queryParams.endDate).toBe("2024-12-31");
    });
  });

  describe("Aggregation edge cases (toNumber)", () => {
    it("should handle null values in toNumber", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.read.mockResolvedValue({ records: [{ get: vi.fn(() => null) }] });

      const result = await repository.findUsageSummary({});

      expect(result.totalCredits).toBe(0);
    });

    it("should handle undefined values in toNumber", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.read.mockResolvedValue({ records: [{ get: vi.fn(() => undefined) }] });

      const result = await repository.findUsageSummary({});

      expect(result.totalCredits).toBe(0);
    });

    it("should handle number values in toNumber", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.read.mockResolvedValue({ records: [{ get: vi.fn(() => 100) }] });

      const result = await repository.findUsageSummary({});

      expect(result.totalCredits).toBe(100);
    });

    it("should convert Neo4j Integer-like values via toNumber", async () => {
      neo4jService.initQuery.mockReturnValue(createMockQuery());
      neo4jService.read.mockResolvedValue({
        records: [{ get: vi.fn(() => ({ toNumber: () => 42 })) }],
      });

      const result = await repository.findUsageSummary({});

      expect(result.totalCredits).toBe(42);
    });
  });
});
