import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { RelevancyRepository } from "../relevancy.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { User } from "../../../user";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";
import { JsonApiCursorInterface } from "../../../../core/jsonapi/interfaces/jsonapi.cursor.interface";

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

  const createMockQuery = (): { query: string; queryParams: Record<string, any> } => ({
    query: "",
    queryParams: {},
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelevancyRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: SecurityService, useValue: securityService },
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
});
