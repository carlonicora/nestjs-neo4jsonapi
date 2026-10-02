import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { RelevancyRepository } from "../relevancy.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { User } from "../../../user/entities/user";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";
import { JsonApiCursorInterface } from "../../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { ContentCypherService } from "../../../content/services/content.cypher.service";
import { ContentExtensionConfig } from "../../../content/interfaces/content.extension.interface";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  contentId: "770e8400-e29b-41d4-a716-446655440002",
  authorId: "880e8400-e29b-41d4-a716-446655440003",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  readCount: vi.fn(),
  initQuery: vi.fn(),
});

const createMockSecurityService = () => ({
  userHasAccess: vi.fn(),
});

const createMockCypherService = () => ({
  userHasAccess: vi.fn(),
  returnStatement: vi.fn(),
});

const createMockModel = <T>(): DataModelInterface<T> =>
  ({
    nodeName: "content",
    primaryNode: "content",
  }) as DataModelInterface<T>;

describe("RelevancyRepository", () => {
  let repository: RelevancyRepository<any>;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let securityService: ReturnType<typeof createMockSecurityService>;
  /** The configured `baseConfig.contentTypes` labels; a test may empty it. */
  let contentTypes: string[];
  let configService: { get: ReturnType<typeof vi.fn> };

  // What initQuery returns with a company in CLS (the source check needs one).
  const createMockQuery = (): { query: string; queryParams: Record<string, any> } => ({
    query: "",
    queryParams: { companyId: TEST_IDS.companyId },
  });

  const MOCK_CURSOR: JsonApiCursorInterface = {
    limit: 10,
    offset: 0,
  };

  const MOCK_CONTENT = {
    id: TEST_IDS.contentId,
    name: "Test Content",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };

  const MOCK_USER: User = {
    id: TEST_IDS.userId,
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as User;

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();
    securityService = createMockSecurityService();
    contentTypes = ["Article", "Document"];
    configService = { get: vi.fn((key: string) => (key === "contentTypes" ? { types: contentTypes } : undefined)) };
    // The source content is accessible unless a test says otherwise.
    neo4jService.readOne.mockResolvedValue({ id: TEST_IDS.contentId });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelevancyRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: SecurityService, useValue: securityService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    repository = module.get<RelevancyRepository<any>>(RelevancyRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findById", () => {
    it("should find relevant content by ID", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CONTENT]);
      mockCypherService.userHasAccess.mockReturnValue("user-access-check");
      mockCypherService.returnStatement.mockReturnValue("RETURN content");
      securityService.userHasAccess.mockReturnValue("security-check");

      const result = await repository.findById({
        model: mockModel,
        cypherService: mockCypherService,
        id: TEST_IDS.contentId,
        cursor: MOCK_CURSOR,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          serialiser: mockModel,
          cursor: MOCK_CURSOR,
        }),
      );
      expect(mockQuery.queryParams.id).toBe(TEST_IDS.contentId);
      expect(mockQuery.query).toContain("totalScore > 20");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_CONTENT]);
    });

    it("should return empty array when no relevant content found", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      mockCypherService.userHasAccess.mockReturnValue("");
      mockCypherService.returnStatement.mockReturnValue("");
      securityService.userHasAccess.mockReturnValue("");

      const result = await repository.findById({
        model: mockModel,
        cypherService: mockCypherService,
        id: TEST_IDS.contentId,
        cursor: MOCK_CURSOR,
      });

      expect(result).toEqual([]);
    });

    it("should handle errors from Neo4jService", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockRejectedValue(new Error("Database error"));
      mockCypherService.userHasAccess.mockReturnValue("");
      mockCypherService.returnStatement.mockReturnValue("");
      securityService.userHasAccess.mockReturnValue("");

      await expect(
        repository.findById({
          model: mockModel,
          cypherService: mockCypherService,
          id: TEST_IDS.contentId,
          cursor: MOCK_CURSOR,
        }),
      ).rejects.toThrow("Database error");
    });

    it("should call securityService.userHasAccess with validator function", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      mockCypherService.userHasAccess.mockReturnValue("user-has-access-query");
      mockCypherService.returnStatement.mockReturnValue("RETURN content");
      securityService.userHasAccess.mockReturnValue("security-query");

      await repository.findById({
        model: mockModel,
        cypherService: mockCypherService,
        id: TEST_IDS.contentId,
        cursor: MOCK_CURSOR,
      });

      expect(securityService.userHasAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          validator: expect.any(Function),
        }),
      );
    });

    it("binds the id as a parameter and never interpolates it", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      mockCypherService.userHasAccess.mockReturnValue("");
      mockCypherService.returnStatement.mockReturnValue("");
      securityService.userHasAccess.mockReturnValue("");

      await repository.findById({
        model: mockModel,
        cypherService: mockCypherService,
        id: "abc-123",
        cursor: MOCK_CURSOR,
      });

      const issued = neo4jService.readMany.mock.calls[0][0];
      expect(issued.query).toContain("<> $id");
      expect(issued.query).not.toContain("abc-123");
      expect(issued.queryParams.id).toBe("abc-123");
    });

    it("re-binds the tenant guard when the query carries a company and a current user", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      mockQuery.queryParams = {
        companyId: TEST_IDS.companyId,
        currentUserId: TEST_IDS.userId,
      };

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      mockCypherService.userHasAccess.mockReturnValue("");
      mockCypherService.returnStatement.mockReturnValue("");
      securityService.userHasAccess.mockReturnValue("");

      await repository.findById({
        model: mockModel,
        cypherService: mockCypherService,
        id: TEST_IDS.contentId,
        cursor: MOCK_CURSOR,
      });

      const issued = neo4jService.readMany.mock.calls[0][0];
      expect(issued.query).toContain("MATCH (company:Company {id: $companyId})");
      expect(issued.query).toContain("MATCH (currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company)");
    });
  });

  describe("findByUser", () => {
    it("should find relevant content by user", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CONTENT]);
      mockCypherService.userHasAccess.mockReturnValue("user-access-check");
      mockCypherService.returnStatement.mockReturnValue("RETURN content");
      securityService.userHasAccess.mockReturnValue("security-check");

      const result = await repository.findByUser({
        model: mockModel,
        cypherService: mockCypherService,
        id: TEST_IDS.userId,
        cursor: MOCK_CURSOR,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          serialiser: mockModel,
          cursor: MOCK_CURSOR,
        }),
      );
      expect(mockQuery.queryParams.id).toBe(TEST_IDS.userId);
      expect(mockQuery.query).toContain("author.id <> $id");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_CONTENT]);
    });

    it("cuts the page after the access check (one {CURSOR}, ordered by totalScore), like findById", async () => {
      const mockQuery = createMockQuery();
      mockQuery.queryParams = { companyId: TEST_IDS.companyId, currentUserId: TEST_IDS.userId };
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      mockCypherService.userHasAccess.mockReturnValue("WITH content, company, currentUser, totalScore WHERE <ACCESS>");
      mockCypherService.returnStatement.mockReturnValue("RETURN content");
      securityService.userHasAccess.mockImplementation(({ validator }: { validator: () => string }) => validator());

      await repository.findByUser({
        model: createMockModel(),
        cypherService: mockCypherService,
        id: TEST_IDS.authorId,
        cursor: MOCK_CURSOR,
      });

      const query = mockQuery.query.replace(/\s+/g, " ");
      // The scoring fragment no longer cuts the page: exactly one cut, after the access check.
      expect(query.split("{CURSOR}")).toHaveLength(2);
      expect(query.split("ORDER BY totalScore DESC")).toHaveLength(2);
      expect(query).toContain("WHERE <ACCESS> WITH * ORDER BY totalScore DESC {CURSOR} RETURN content");
      expect(query.indexOf("{CURSOR}")).toBeGreaterThan(query.indexOf("content_author.id <> $id"));
      expect(query.indexOf("{CURSOR}")).toBeGreaterThan(query.indexOf("MATCH (currentUser:User {id: $currentUserId})"));
    });

    it("ties the author to the caller's company inside the scoring fragment (a foreign author scores nothing)", async () => {
      // No `company` bound by initQuery (empty prefix): the fragment itself must
      // carry the company predicate, or an author of any company would match.
      const mockQuery = createMockQuery();
      mockQuery.queryParams = { companyId: TEST_IDS.companyId };
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      mockCypherService.returnStatement.mockReturnValue("RETURN content");
      securityService.userHasAccess.mockReturnValue("");

      await repository.findByUser({
        model: createMockModel(),
        cypherService: mockCypherService,
        id: TEST_IDS.authorId,
        cursor: MOCK_CURSOR,
      });

      const query = mockQuery.query.replace(/\s+/g, " ");
      expect(query).toContain("MATCH (author {id: $id})-[:BELONGS_TO]->(company:Company {id: $companyId})");
      expect(query).not.toContain("MATCH (author {id: $id})-[:BELONGS_TO]->(company) ");
      expect(mockQuery.queryParams).toMatchObject({ id: TEST_IDS.authorId, companyId: TEST_IDS.companyId });
    });

    it("should return empty array when no content found for user", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      mockCypherService.userHasAccess.mockReturnValue("");
      mockCypherService.returnStatement.mockReturnValue("");
      securityService.userHasAccess.mockReturnValue("");

      const result = await repository.findByUser({
        model: mockModel,
        cypherService: mockCypherService,
        id: TEST_IDS.userId,
        cursor: MOCK_CURSOR,
      });

      expect(result).toEqual([]);
    });

    it("should handle errors from Neo4jService", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockRejectedValue(new Error("Database error"));
      mockCypherService.userHasAccess.mockReturnValue("");
      mockCypherService.returnStatement.mockReturnValue("");
      securityService.userHasAccess.mockReturnValue("");

      await expect(
        repository.findByUser({
          model: mockModel,
          cypherService: mockCypherService,
          id: TEST_IDS.userId,
          cursor: MOCK_CURSOR,
        }),
      ).rejects.toThrow("Database error");
    });
  });

  describe("findUsersById", () => {
    it("should find users by content ID", async () => {
      const mockQuery = createMockQuery();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USER]);

      const result = await repository.findUsersById({
        cypherService: mockCypherService,
        id: TEST_IDS.contentId,
        cursor: MOCK_CURSOR,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: MOCK_CURSOR,
        }),
      );
      expect(mockQuery.queryParams.id).toBe(TEST_IDS.contentId);
      expect(mockQuery.query).toContain("author as user");
      expect(mockQuery.query).toContain("RETURN user, totalScore");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_USER]);
    });

    it("should return multiple users", async () => {
      const mockQuery = createMockQuery();
      const mockCypherService = createMockCypherService();

      const secondUser: User = {
        id: TEST_IDS.authorId,
        email: "author@example.com",
        firstName: "Author",
        lastName: "User",
        createdAt: new Date("2025-01-02T00:00:00Z"),
        updatedAt: new Date("2025-01-02T00:00:00Z"),
      } as User;

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_USER, secondUser]);

      const result = await repository.findUsersById({
        cypherService: mockCypherService,
        id: TEST_IDS.contentId,
        cursor: MOCK_CURSOR,
      });

      expect(result).toHaveLength(2);
      expect(result).toEqual([MOCK_USER, secondUser]);
    });

    it("should return empty array when no users found", async () => {
      const mockQuery = createMockQuery();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findUsersById({
        cypherService: mockCypherService,
        id: TEST_IDS.contentId,
        cursor: MOCK_CURSOR,
      });

      expect(result).toEqual([]);
    });

    it("should handle errors from Neo4jService", async () => {
      const mockQuery = createMockQuery();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockRejectedValue(new Error("Database error"));

      await expect(
        repository.findUsersById({
          cypherService: mockCypherService,
          id: TEST_IDS.contentId,
          cursor: MOCK_CURSOR,
        }),
      ).rejects.toThrow("Database error");
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact ID values", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      mockCypherService.userHasAccess.mockReturnValue("");
      mockCypherService.returnStatement.mockReturnValue("");
      securityService.userHasAccess.mockReturnValue("");

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.findById({
        model: mockModel,
        cypherService: mockCypherService,
        id: exactId,
        cursor: MOCK_CURSOR,
      });

      expect(mockQuery.queryParams.id).toBe(exactId);
    });

    it("should handle cursor with different values", async () => {
      const mockQuery = createMockQuery();
      const mockModel = createMockModel();
      const mockCypherService = createMockCypherService();

      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      mockCypherService.userHasAccess.mockReturnValue("");
      mockCypherService.returnStatement.mockReturnValue("");
      securityService.userHasAccess.mockReturnValue("");

      const customCursor: JsonApiCursorInterface = {
        limit: 50,
        offset: 100,
      };

      await repository.findById({
        model: mockModel,
        cypherService: mockCypherService,
        id: TEST_IDS.contentId,
        cursor: customCursor,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: customCursor,
        }),
      );
    });
  });
  describe("content access predicates (real ContentCypherService)", () => {
    const CLS_VALUES: Record<string, unknown> = {
      companyId: TEST_IDS.companyId,
      userId: TEST_IDS.userId,
    };

    const buildContentCypherService = (extension?: ContentExtensionConfig) =>
      new ContentCypherService(
        { get: vi.fn((key: string) => CLS_VALUES[key]) } as any,
        { get: vi.fn().mockReturnValue({ types: ["Article", "Document"] }) } as any,
        extension,
      );

    const WITH_PREDICATES: ContentExtensionConfig = {
      additionalRelationships: [],
      accessPredicates: { Document: "<DOC>" },
    };

    /** A repository whose source check uses the given ContentCypherService. */
    const buildRepository = (contentCypherService?: ContentCypherService) =>
      new RelevancyRepository<any>(
        neo4jService as any,
        securityService as any,
        configService as any,
        contentCypherService,
      );

    const prepare = () => {
      const mockQuery = createMockQuery();
      mockQuery.queryParams = { companyId: TEST_IDS.companyId, currentUserId: TEST_IDS.userId };
      // 1st initQuery: the source access check; 2nd: the relevance read.
      neo4jService.initQuery
        .mockReturnValueOnce({
          query: "",
          queryParams: { companyId: TEST_IDS.companyId, currentUserId: TEST_IDS.userId },
        })
        .mockReturnValueOnce(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);
      securityService.userHasAccess.mockImplementation(({ validator }: { validator: () => string }) => validator());
      return mockQuery;
    };

    const runFindById = async (
      cypherService: ContentCypherService,
      repo: RelevancyRepository<any> = repository,
    ): Promise<string> => {
      const mockQuery = prepare();

      await repo.findById({
        model: createMockModel(),
        cypherService: cypherService,
        id: TEST_IDS.contentId,
        cursor: MOCK_CURSOR,
      });

      return mockQuery.query.replace(/\s+/g, " ");
    };

    it("filters relevant contents by the configured per-label predicate", async () => {
      const query = await runFindById(buildContentCypherService(WITH_PREDICATES));

      expect(query).toContain(
        "MATCH (currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company) " +
          "WITH content, company, currentUser, totalScore " +
          "WHERE (NOT content:Document OR (<DOC>)) " +
          "WITH content, company, currentUser, totalScore " +
          "WITH * ORDER BY totalScore DESC {CURSOR} " +
          "MATCH (content)-[:BELONGS_TO]->(content_company:Company)",
      );
    });

    it("cuts the page after the access filter (one {CURSOR}, ordered by totalScore) with predicates", async () => {
      const query = await runFindById(buildContentCypherService(WITH_PREDICATES));

      expect(query.split("{CURSOR}")).toHaveLength(2);
      expect(query.split("ORDER BY totalScore DESC")).toHaveLength(2);
      expect(query.indexOf("{CURSOR}")).toBeGreaterThan(query.indexOf("(NOT content:Document OR (<DOC>))"));
      expect(query.indexOf("{CURSOR}")).toBeGreaterThan(query.indexOf("totalScore > 20"));
    });

    it("cuts the page after every filter without accessPredicates too (no row is dropped after {CURSOR})", async () => {
      const query = await runFindById(buildContentCypherService());

      // The scoring fragment no longer cuts the page: the source exclusion and
      // the score threshold run first, then the access projection, then the cut.
      expect(query).toContain(
        "END AS totalScore WITH content as content, totalScore WHERE content.id <> $id AND totalScore > 20 " +
          "MATCH (company:Company {id: $companyId}) " +
          "MATCH (currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company) " +
          "WITH content, company, currentUser, totalScore " +
          "WITH * ORDER BY totalScore DESC {CURSOR} " +
          "MATCH (content)-[:BELONGS_TO]->(content_company:Company)",
      );
      expect(query).not.toContain("NOT content:");
      expect(query.split("{CURSOR}")).toHaveLength(2);
      expect(query.split("ORDER BY totalScore DESC")).toHaveLength(2);
    });

    it("gives the cut its own projection for automated jobs (the access check emits nothing)", async () => {
      CLS_VALUES.isAutomatedJob = true;
      securityService.userHasAccess.mockReturnValue("");
      try {
        const mockQuery = prepare();
        securityService.userHasAccess.mockReturnValue("");

        await repository.findById({
          model: createMockModel(),
          cypherService: buildContentCypherService(WITH_PREDICATES),
          id: TEST_IDS.contentId,
          cursor: MOCK_CURSOR,
        });

        const query = mockQuery.query.replace(/\s+/g, " ");
        expect(query).toContain(
          "MATCH (currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company) WITH * ORDER BY totalScore DESC {CURSOR}",
        );
        expect(query).not.toContain("<DOC>");
      } finally {
        delete CLS_VALUES.isAutomatedJob;
      }
    });

    it("constrains the relevance source to the configured content labels", async () => {
      const query = await runFindById(buildContentCypherService());

      expect(query).toContain("MATCH (source:Article|Document {id: $id})-[:BELONGS_TO]->(company)");
    });

    it("keeps the relevance source unlabelled when no content type is configured", async () => {
      contentTypes = [];
      const query = await runFindById(buildContentCypherService());

      expect(query).toContain("MATCH (source {id: $id})-[:BELONGS_TO]->(company)");
    });

    describe("source access check", () => {
      /** prepare() plus the 404/403 probe's own initQuery, between the source check and the relevance read. */
      const prepareWithProbe = () => {
        const mockQuery = createMockQuery();
        mockQuery.queryParams = { companyId: TEST_IDS.companyId, currentUserId: TEST_IDS.userId };
        neo4jService.initQuery
          .mockReturnValueOnce({
            query: "",
            queryParams: { companyId: TEST_IDS.companyId, currentUserId: TEST_IDS.userId },
          })
          .mockReturnValueOnce({
            query: "",
            queryParams: { companyId: TEST_IDS.companyId, currentUserId: TEST_IDS.userId },
          })
          .mockReturnValueOnce(mockQuery);
        neo4jService.readMany.mockResolvedValue([]);
        securityService.userHasAccess.mockImplementation(({ validator }: { validator: () => string }) => validator());
        return mockQuery;
      };
      const findById = (repo: RelevancyRepository<any>, contentCypherService: ContentCypherService) =>
        repo.findById({
          model: createMockModel(),
          cypherService: contentCypherService,
          id: TEST_IDS.contentId,
          cursor: MOCK_CURSOR,
        });

      it("checks the source with company scoping and the content access rule before relevance", async () => {
        const contentCypherService = buildContentCypherService(WITH_PREDICATES);
        await runFindById(contentCypherService, buildRepository(contentCypherService));

        expect(neo4jService.initQuery.mock.calls[0][0]).toEqual(
          expect.objectContaining({ serialiser: expect.objectContaining({ nodeName: "content" }) }),
        );
        const source = neo4jService.readOne.mock.calls[0][0];
        expect(source.query.replace(/\s+/g, " ")).toContain(
          "MATCH (content:Article|Document {id: $id})-[:BELONGS_TO]->(company) " +
            "WITH content, company, currentUser " +
            "WHERE (NOT content:Document OR (<DOC>)) " +
            "WITH content, company, currentUser " +
            "RETURN content",
        );
        expect(source.queryParams).toEqual({
          companyId: TEST_IDS.companyId,
          currentUserId: TEST_IDS.userId,
          id: TEST_IDS.contentId,
        });
        expect(neo4jService.readOne).toHaveBeenCalledTimes(1);
        expect(neo4jService.readCount).not.toHaveBeenCalled();
        expect(neo4jService.readMany).toHaveBeenCalledTimes(1);
      });

      it("applies company scoping only when no ContentCypherService is available", async () => {
        await runFindById(buildContentCypherService(WITH_PREDICATES), buildRepository(undefined));

        const normalised = neo4jService.readOne.mock.calls[0][0].query.replace(/\s+/g, " ");
        expect(normalised).toContain(
          "MATCH (content:Article|Document {id: $id})-[:BELONGS_TO]->(company) RETURN content",
        );
        expect(normalised).not.toContain("<DOC>");
      });

      it("returns 403 and computes nothing when the source is in the caller's company but cannot be opened", async () => {
        const contentCypherService = buildContentCypherService(WITH_PREDICATES);
        prepareWithProbe();
        neo4jService.readOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: TEST_IDS.contentId });

        await expect(findById(buildRepository(contentCypherService), contentCypherService)).rejects.toMatchObject({
          status: 403,
        });
        const probe = neo4jService.readOne.mock.calls[1][0];
        // The probe joins the bound company: it only ever sees the caller's own firm.
        expect(probe.query.replace(/\s+/g, " ")).toContain(
          "MATCH (content:Article|Document {id: $id})-[:BELONGS_TO]->(company) RETURN content",
        );
        expect(probe.queryParams).toEqual(
          expect.objectContaining({ companyId: TEST_IDS.companyId, id: TEST_IDS.contentId }),
        );
        expect(neo4jService.initQuery.mock.calls[1][0]).toEqual(
          expect.objectContaining({ serialiser: expect.objectContaining({ nodeName: "content" }) }),
        );
        expect(neo4jService.readMany).not.toHaveBeenCalled();
      });

      it("returns 404 for another firm's content id (the company-scoped probe finds nothing)", async () => {
        const contentCypherService = buildContentCypherService(WITH_PREDICATES);
        prepareWithProbe();
        neo4jService.readOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

        await expect(findById(buildRepository(contentCypherService), contentCypherService)).rejects.toMatchObject({
          status: 404,
        });
        expect(neo4jService.readMany).not.toHaveBeenCalled();
      });

      it("returns 404 without querying when no company is in context (fail closed)", async () => {
        const contentCypherService = buildContentCypherService(WITH_PREDICATES);
        neo4jService.initQuery.mockReturnValueOnce({
          query: "",
          queryParams: { companyId: null, currentUserId: null },
        });

        await expect(findById(buildRepository(contentCypherService), contentCypherService)).rejects.toMatchObject({
          status: 404,
        });
        expect(neo4jService.readOne).not.toHaveBeenCalled();
        expect(neo4jService.readMany).not.toHaveBeenCalled();
      });

      it("keeps both source lookups unlabelled when no content type is configured", async () => {
        contentTypes = [];
        const contentCypherService = buildContentCypherService(WITH_PREDICATES);
        prepareWithProbe();
        neo4jService.readOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: TEST_IDS.contentId });

        await expect(findById(buildRepository(contentCypherService), contentCypherService)).rejects.toMatchObject({
          status: 403,
        });
        expect(neo4jService.readOne.mock.calls[0][0].query.replace(/\s+/g, " ")).toContain(
          "MATCH (content {id: $id})-[:BELONGS_TO]->(company)",
        );
        expect(neo4jService.readOne.mock.calls[1][0].query.replace(/\s+/g, " ")).toContain(
          "MATCH (content {id: $id})-[:BELONGS_TO]->(company) RETURN content",
        );
      });

      it("constrains the user-relevance source to the configured content labels", async () => {
        const contentCypherService = buildContentCypherService(WITH_PREDICATES);
        const mockQuery = prepare();

        await buildRepository(contentCypherService).findUsersById({
          cypherService: {},
          id: TEST_IDS.contentId,
          cursor: MOCK_CURSOR,
        });

        expect(mockQuery.query.replace(/\s+/g, " ")).toContain(
          "MATCH (source:Article|Document {id: $id})-[:BELONGS_TO]->(company)",
        );
      });

      it("guards /contents/:id/user-relevance (findUsersById) with the same check", async () => {
        const contentCypherService = buildContentCypherService(WITH_PREDICATES);
        prepareWithProbe();
        neo4jService.readOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: TEST_IDS.contentId });

        await expect(
          buildRepository(contentCypherService).findUsersById({
            cypherService: {},
            id: TEST_IDS.contentId,
            cursor: MOCK_CURSOR,
          }),
        ).rejects.toMatchObject({ status: 403 });
        expect(neo4jService.readOne.mock.calls[0][0].query.replace(/\s+/g, " ")).toContain(
          "WHERE (NOT content:Document OR (<DOC>))",
        );
        expect(neo4jService.readMany).not.toHaveBeenCalled();
      });
    });
  });
});
