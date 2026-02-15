import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ContentRepository } from "../content.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { ContentCypherService } from "../../services/content.cypher.service";
import { Content } from "../../entities/content.entity";
import { modelRegistry } from "../../../../common/registries/registry";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  contentId1: "770e8400-e29b-41d4-a716-446655440002",
  contentId2: "880e8400-e29b-41d4-a716-446655440003",
  ownerId: "990e8400-e29b-41d4-a716-446655440004",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  initQuery: vi.fn(),
});

const createMockConfigService = () => ({
  get: vi.fn((key: string) => {
    if (key === "contentTypes") {
      return { types: ["Article", "Document"] };
    }
    return null;
  }),
});

const createMockSecurityService = () => ({
  userHasAccess: vi.fn(({ validator }: { validator: () => string }) => validator()),
  isCurrentUserCompanyAdmin: vi.fn().mockReturnValue(true),
});

const createMockContentCypherService = () => ({
  default: vi.fn().mockReturnValue("MATCH (content:Article|Document)"),
  userHasAccess: vi.fn().mockReturnValue("WITH content, company, currentUser"),
  returnStatement: vi.fn().mockReturnValue("RETURN content"),
});

// Mock the model registry
vi.mock("../../../../common/registries/registry", () => ({
  modelRegistry: {
    get: vi.fn(),
  },
}));

describe("ContentRepository", () => {
  let repository: ContentRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let configService: ReturnType<typeof createMockConfigService>;
  let securityService: ReturnType<typeof createMockSecurityService>;
  let contentCypherService: ReturnType<typeof createMockContentCypherService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {},
  });

  const MOCK_CONTENT: Content = {
    id: TEST_IDS.contentId1,
    name: "Test Content",
    contentType: "Article",
    abstract: "Test abstract",
    tldr: "Test TLDR",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as Content;

  const MOCK_CONTENT_MODEL = {
    nodeName: "content",
    labelName: "Content",
    type: "contents",
  };

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();
    configService = createMockConfigService();
    securityService = createMockSecurityService();
    contentCypherService = createMockContentCypherService();

    // Setup model registry mock
    vi.mocked(modelRegistry.get).mockReturnValue(MOCK_CONTENT_MODEL as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentRepository,
        { provide: Neo4jService, useValue: neo4jService },
        { provide: ConfigService, useValue: configService },
        { provide: SecurityService, useValue: securityService },
        { provide: ContentCypherService, useValue: contentCypherService },
      ],
    }).compile();

    repository = module.get<ContentRepository>(ContentRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("find", () => {
    it("should find content with default ordering", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CONTENT]);

      const result = await repository.find({});

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          serialiser: MOCK_CONTENT_MODEL,
        }),
      );
      expect(contentCypherService.default).toHaveBeenCalled();
      expect(securityService.userHasAccess).toHaveBeenCalled();
      expect(contentCypherService.returnStatement).toHaveBeenCalled();
      expect(mockQuery.query).toContain("ORDER BY content.updatedAt DESC");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_CONTENT]);
    });

    it("should find content with custom ordering", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CONTENT]);

      await repository.find({ orderBy: "name ASC" });

      expect(mockQuery.query).toContain("ORDER BY content.name ASC");
    });

    it("should pass search term to query params", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CONTENT]);

      await repository.find({ term: "search term" });

      expect(mockQuery.queryParams.term).toBe("search term");
    });

    it("should pass cursor to initQuery", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const cursor = { limit: 10, offset: 20 };
      await repository.find({ cursor });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor,
        }),
      );
    });

    it("should pass fetchAll to initQuery", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.find({ fetchAll: true });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          fetchAll: true,
        }),
      );
    });

    it("should return empty array when no content found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.find({});

      expect(result).toEqual([]);
    });
  });

  describe("findByIds", () => {
    it("should find content by IDs", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CONTENT]);

      const contentIds = [TEST_IDS.contentId1, TEST_IDS.contentId2];
      const result = await repository.findByIds({ contentIds });

      expect(mockQuery.queryParams.ids).toEqual(contentIds);
      expect(mockQuery.query).toContain("content.id IN $ids");
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_CONTENT]);
    });

    it("should match content types from config", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findByIds({ contentIds: [TEST_IDS.contentId1] });

      expect(mockQuery.query).toContain("Article|Document");
    });

    it("should return empty array when no matching content found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByIds({ contentIds: ["nonexistent"] });

      expect(result).toEqual([]);
    });

    it("should handle empty contentIds array", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByIds({ contentIds: [] });

      expect(mockQuery.queryParams.ids).toEqual([]);
      expect(result).toEqual([]);
    });
  });

  describe("findByOwner", () => {
    it("should find content by owner", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CONTENT]);

      const result = await repository.findByOwner({ ownerId: TEST_IDS.ownerId });

      expect(mockQuery.queryParams.ownerId).toBe(TEST_IDS.ownerId);
      expect(mockQuery.query).toContain(":PUBLISHED");
      expect(mockQuery.query).toContain("{id: $ownerId}");
      expect(contentCypherService.default).toHaveBeenCalled();
      expect(contentCypherService.returnStatement).toHaveBeenCalled();
      expect(neo4jService.readMany).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual([MOCK_CONTENT]);
    });

    it("should use default ordering when not specified", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CONTENT]);

      await repository.findByOwner({ ownerId: TEST_IDS.ownerId });

      expect(mockQuery.query).toContain("ORDER BY content.updatedAt DESC");
    });

    it("should use custom ordering when specified", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_CONTENT]);

      await repository.findByOwner({ ownerId: TEST_IDS.ownerId, orderBy: "name ASC" });

      expect(mockQuery.query).toContain("ORDER BY content.name ASC");
    });

    it("should pass term to query params", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findByOwner({ ownerId: TEST_IDS.ownerId, term: "search" });

      expect(mockQuery.queryParams.term).toBe("search");
    });

    it("should pass cursor and fetchAll to initQuery", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const cursor = { limit: 5, offset: 0 };
      await repository.findByOwner({
        ownerId: TEST_IDS.ownerId,
        cursor,
        fetchAll: true,
      });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor,
          fetchAll: true,
        }),
      );
    });

    it("should return empty array when owner has no content", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findByOwner({ ownerId: "nonexistent-owner" });

      expect(result).toEqual([]);
    });
  });

  describe("getContentModel (private method via public usage)", () => {
    it("should throw error when model not found in registry", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      vi.mocked(modelRegistry.get).mockReturnValue(undefined);

      await expect(repository.find({})).rejects.toThrow("ContentModel not found in registry for nodeName: content");
    });

    it("should use model from registry for serialiser", async () => {
      const customModel = {
        nodeName: "content",
        labelName: "Content",
        type: "contents",
        customField: true,
      };
      vi.mocked(modelRegistry.get).mockReturnValue(customModel as any);

      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.find({});

      expect(neo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          serialiser: customModel,
        }),
      );
    });
  });

  describe("getContentTypes (private method via public usage)", () => {
    it("should use content types from config", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findByIds({ contentIds: [TEST_IDS.contentId1] });

      expect(configService.get).toHaveBeenCalledWith("contentTypes");
      expect(mockQuery.query).toContain("Article|Document");
    });

    it("should fallback to Content label when contentTypes not configured", async () => {
      configService.get.mockReturnValue(undefined);

      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findByIds({ contentIds: [TEST_IDS.contentId1] });

      // Should fallback to Content label instead of empty types
      expect(mockQuery.query).toContain(":Content)-[:BELONGS_TO]");
    });
  });

  describe("Error Handling", () => {
    it("should propagate errors from neo4jService.readMany", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockRejectedValue(new Error("Database error"));

      await expect(repository.find({})).rejects.toThrow("Database error");
    });

    it("should propagate errors from security service", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      securityService.userHasAccess.mockImplementation(() => {
        throw new Error("Access denied");
      });

      await expect(repository.find({})).rejects.toThrow("Access denied");
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined term parameter", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.find({ term: undefined });

      expect(mockQuery.queryParams.term).toBeUndefined();
    });

    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.findByOwner({ ownerId: exactId });

      expect(mockQuery.queryParams.ownerId).toBe(exactId);
    });

    it("should handle special characters in search term", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const specialTerm = "test with 'quotes' and \"double quotes\"";
      await repository.find({ term: specialTerm });

      expect(mockQuery.queryParams.term).toBe(specialTerm);
    });
  });
});
