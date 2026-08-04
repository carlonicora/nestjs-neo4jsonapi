import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { ContentCypherService } from "../content.cypher.service";
import { CONTENT_EXTENSION_CONFIG, ContentExtensionConfig } from "../../interfaces/content.extension.interface";

describe("ContentCypherService", () => {
  let service: ContentCypherService;
  let clsService: MockedObject<ClsService>;
  let configService: MockedObject<ConfigService>;

  const TEST_IDS = {
    companyId: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440001",
  };

  const createMockClsService = () => ({
    get: vi.fn(),
    set: vi.fn(),
    run: vi.fn(),
  });

  const createMockConfigService = () => ({
    get: vi.fn().mockReturnValue({
      types: ["Article", "Document", "Note"],
    }),
  });

  const createServiceWithExtension = async (extension?: ContentExtensionConfig) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentCypherService,
        { provide: ClsService, useValue: createMockClsService() },
        { provide: ConfigService, useValue: createMockConfigService() },
        ...(extension ? [{ provide: CONTENT_EXTENSION_CONFIG, useValue: extension }] : []),
      ],
    }).compile();

    return {
      service: module.get<ContentCypherService>(ContentCypherService),
      clsService: module.get(ClsService) as MockedObject<ClsService>,
      configService: module.get(ConfigService) as MockedObject<ConfigService>,
    };
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const result = await createServiceWithExtension();
    service = result.service;
    clsService = result.clsService;
    configService = result.configService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });

    it("should create service without extension", () => {
      expect(service).toBeDefined();
    });
  });

  describe("default", () => {
    it("should generate default match query without params", () => {
      // Act
      const result = service.default();

      // Assert
      expect(result).toContain("MATCH (content:Article|Document|Note");
      expect(result).toContain("WHERE $companyId IS NULL");
    });

    it("should include search field when provided", () => {
      // Act
      const result = service.default({ searchField: "id" });

      // Assert
      expect(result).toContain("{id: $searchValue}");
    });

    it("should include company and user in WITH clause by default", () => {
      // Act
      const result = service.default();

      // Assert
      expect(result).toContain("WITH content, company, currentUser");
    });

    it("should block company and user from WITH clause when specified", () => {
      // Act
      const result = service.default({ searchField: "id", blockCompanyAndUser: true });

      // Assert
      expect(result).toContain("WITH content");
      expect(result).not.toContain("company, currentUser");
    });

    it("should handle empty content types", () => {
      // Arrange
      configService.get.mockReturnValue({ types: [] });

      // Act
      const result = service.default();

      // Assert
      expect(result).toContain("MATCH (content:");
    });
  });

  describe("userHasAccess", () => {
    it("should generate WITH clause with company when companyId is set", () => {
      // Arrange
      clsService.get.mockImplementation((key: string) => {
        if (key === "companyId") return TEST_IDS.companyId;
        if (key === "userId") return TEST_IDS.userId;
        return undefined;
      });

      // Act
      const result = service.userHasAccess();

      // Assert
      expect(result).toContain("WITH content, company, currentUser");
    });

    it("should exclude company from WITH clause when companyId is not set", () => {
      // Arrange
      clsService.get.mockImplementation((key: string) => {
        if (key === "userId") return TEST_IDS.userId;
        return undefined;
      });

      // Act
      const result = service.userHasAccess();

      // Assert
      expect(result).toContain("WITH content, currentUser");
      expect(result).not.toContain("company");
    });

    it("should exclude user from WITH clause when userId is not set", () => {
      // Arrange
      clsService.get.mockImplementation((key: string) => {
        if (key === "companyId") return TEST_IDS.companyId;
        return undefined;
      });

      // Act
      const result = service.userHasAccess();

      // Assert
      expect(result).toContain("WITH content, company");
      expect(result).not.toContain("currentUser");
    });

    it("should include totalScore when useTotalScore is true", () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.companyId);

      // Act
      const result = service.userHasAccess({ useTotalScore: true });

      // Assert
      expect(result).toContain("totalScore");
    });

    it("should not include totalScore when useTotalScore is false", () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.companyId);

      // Act
      const result = service.userHasAccess({ useTotalScore: false });

      // Assert
      expect(result).not.toContain("totalScore");
    });
  });

  describe("returnStatement", () => {
    it("should generate return statement with core relationships", () => {
      // Act
      const result = service.returnStatement();

      // Assert
      expect(result).toContain("MATCH (content)-[:BELONGS_TO]->(content_company:");
      expect(result).toContain("MATCH (content)<-[:PUBLISHED]-(content_owner:");
      // The author match is OPTIONAL (it duplicates the owner's PUBLISHED edge,
      // so the row set is unchanged) but it is still emitted by default.
      expect(result).toContain("OPTIONAL MATCH (content)<-[:PUBLISHED]-(content_author:");
      expect(result).toContain("RETURN content");
      expect(result).toContain("content_company");
      expect(result).toContain("content_owner");
      expect(result).toContain("content_author");
    });

    it("should include totalScore when useTotalScore is true", () => {
      // Act
      const result = service.returnStatement({ useTotalScore: true });

      // Assert
      expect(result).toContain("totalScore");
    });

    it("should not include totalScore when useTotalScore is false", () => {
      // Act
      const result = service.returnStatement({ useTotalScore: false });

      // Assert
      expect(result).not.toMatch(/,\s*totalScore/);
    });

    it("should add extension relationships when configured", async () => {
      // Arrange
      const extension: ContentExtensionConfig = {
        additionalRelationships: [
          {
            relationship: "HAS_CATEGORY",
            direction: "out",
            model: { nodeName: "category", labelName: "Category" },
          },
        ],
      };
      const { service: extService } = await createServiceWithExtension(extension);

      // Act
      const result = extService.returnStatement();

      // Assert
      expect(result).toContain("OPTIONAL MATCH (content)-[:HAS_CATEGORY]->(content_category:Category)");
      expect(result).toContain("content_category");
    });

    it("should handle inbound relationships", async () => {
      // Arrange
      const extension: ContentExtensionConfig = {
        additionalRelationships: [
          {
            relationship: "TAGGED",
            direction: "in",
            model: { nodeName: "tag", labelName: "Tag" },
          },
        ],
      };
      const { service: extService } = await createServiceWithExtension(extension);

      // Act
      const result = extService.returnStatement();

      // Assert
      expect(result).toContain("OPTIONAL MATCH (content)<-[:TAGGED]-(content_tag:Tag)");
    });

    it("should handle multiple extension relationships", async () => {
      // Arrange
      const extension: ContentExtensionConfig = {
        additionalRelationships: [
          {
            relationship: "HAS_CATEGORY",
            direction: "out",
            model: { nodeName: "category", labelName: "Category" },
          },
          {
            relationship: "TAGGED",
            direction: "in",
            model: { nodeName: "tag", labelName: "Tag" },
          },
        ],
      };
      const { service: extService } = await createServiceWithExtension(extension);

      // Act
      const result = extService.returnStatement();

      // Assert
      expect(result).toContain("content_category");
      expect(result).toContain("content_tag");
    });
  });

  describe("default configuration (package behaviour must not drift)", () => {
    it("should match the owner on a directed PUBLISHED edge", () => {
      expect(service.ownerMatch({ target: "content_owner:User" })).toBe(
        "MATCH (content)<-[:PUBLISHED]-(content_owner:User)",
      );
    });

    it("should match the owner by id on a directed PUBLISHED edge", () => {
      expect(service.ownerMatch({ target: ":User {id: $ownerId}" })).toBe(
        "MATCH (content)<-[:PUBLISHED]-(:User {id: $ownerId})",
      );
    });

    it("should apply no tldr filter", () => {
      expect(service.tldrFilter()).toBe("");
      expect(service.default()).not.toContain("tldr");
    });

    it("should emit no extra meta-field projection", () => {
      expect(service.returnStatement()).not.toContain(" AS ");
    });
  });

  describe("a360ai-shaped configuration", () => {
    const A360_CONFIG: ContentExtensionConfig = {
      additionalRelationships: [],
      ownerMatchPattern: { relationships: ["PUBLISHED", "FROM"], undirected: true },
      requireTldr: true,
      metaFields: [
        {
          key: "proceedingId",
          optionalMatch: "OPTIONAL MATCH (memoProceeding:Proceeding)-[:HAS_MEMO]->(content)",
          returnAlias: "memoProceeding.id",
        },
      ],
      serialiseAuthor: false,
    };

    it("should match the owner on an undirected PUBLISHED|FROM edge", async () => {
      const { service: a360 } = await createServiceWithExtension(A360_CONFIG);

      expect(a360.ownerMatch({ target: "content_owner:User" })).toBe(
        "MATCH (content)-[:PUBLISHED|FROM]-(content_owner:User)",
      );
      expect(a360.returnStatement()).toContain("MATCH (content)-[:PUBLISHED|FROM]-(content_owner:User)");
    });

    it("should filter on a non-empty tldr in the default match", async () => {
      const { service: a360 } = await createServiceWithExtension(A360_CONFIG);

      const result = a360.default();

      expect(result).toContain("WHERE content.tldr IS NOT NULL");
      expect(result).toContain(`AND content.tldr <> ""`);
      expect(result).toContain("AND $companyId IS NULL");
    });

    it("should expose the tldr filter as trailing AND predicates", async () => {
      const { service: a360 } = await createServiceWithExtension(A360_CONFIG);

      const result = a360.tldrFilter();

      expect(result).toContain("AND content.tldr IS NOT NULL");
      expect(result).toContain(`AND content.tldr <> ""`);
    });

    it("should add the meta-field OPTIONAL MATCH and its RETURN projection", async () => {
      const { service: a360 } = await createServiceWithExtension(A360_CONFIG);

      const result = a360.returnStatement();

      expect(result).toContain("OPTIONAL MATCH (memoProceeding:Proceeding)-[:HAS_MEMO]->(content)");
      expect(result).toContain("memoProceeding.id AS proceedingId");
    });

    it("should drop the author match and the author RETURN alias", async () => {
      const { service: a360 } = await createServiceWithExtension(A360_CONFIG);

      expect(a360.returnStatement()).not.toContain("content_author");
    });

    it("should keep totalScore last when requested", async () => {
      const { service: a360 } = await createServiceWithExtension(A360_CONFIG);

      const result = a360.returnStatement({ useTotalScore: true });

      expect(result.indexOf("memoProceeding.id AS proceedingId")).toBeLessThan(result.indexOf("totalScore"));
    });
  });
});
