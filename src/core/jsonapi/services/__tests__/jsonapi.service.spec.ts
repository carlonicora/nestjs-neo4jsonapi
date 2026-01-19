import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../jsonapi.service";
import { JsonApiSerialiserFactory } from "../../factories/jsonapi.serialiser.factory";
import { JsonApiPaginator } from "../../serialisers/jsonapi.paginator";

describe("JsonApiService", () => {
  let service: JsonApiService;
  let mockSerialiserFactory: vi.Mocked<JsonApiSerialiserFactory>;
  let mockClsService: vi.Mocked<ClsService>;
  let mockConfigService: vi.Mocked<ConfigService>;

  const TEST_API_CONFIG = {
    url: "https://api.example.com",
  };

  // Mock serialiser builder that creates a complete serialiser definition
  const createMockBuilder = (type: string, endpoint: string, idField = "id") => {
    return {
      id: idField,
      endpoint,
      endpointParameters: "",
      create: vi.fn().mockReturnValue({
        type,
        id: idField,
        attributes: {
          name: "name",
          description: "description",
        },
        links: {
          self: (data: any) => `https://api.example.com${endpoint}/${data[idField]}`,
        },
      }),
    };
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockSerialiserFactory = {
      create: vi.fn(),
    } as any;

    mockClsService = {
      get: vi.fn(),
    } as any;

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === "api") return TEST_API_CONFIG;
        return undefined;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JsonApiService,
        { provide: JsonApiSerialiserFactory, useValue: mockSerialiserFactory },
        { provide: ClsService, useValue: mockClsService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<JsonApiService>(JsonApiService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("buildSingle", () => {
    const mockModel = { serialiser: class MockSerialiser {} };

    it("should build a single JSON:API resource response", async () => {
      const mockRecord = {
        id: "123",
        name: "Test Item",
        description: "Test Description",
      };

      const mockBuilder = createMockBuilder("items", "/items");
      mockSerialiserFactory.create.mockReturnValue(mockBuilder as any);

      const result = await service.buildSingle(mockModel as any, mockRecord);

      expect(mockSerialiserFactory.create).toHaveBeenCalledWith(mockModel);
      expect(result).toHaveProperty("links");
      expect(result).toHaveProperty("data");
      expect(result.data.type).toBe("items");
      expect(result.data.id).toBe("123");
      expect(result.links.self).toBe("https://api.example.com/items/123");
    });

    it("should throw HttpException 404 when record is null", async () => {
      const mockBuilder = createMockBuilder("items", "/items");
      mockSerialiserFactory.create.mockReturnValue(mockBuilder as any);

      await expect(service.buildSingle(mockModel as any, null)).rejects.toThrow(HttpException);

      try {
        await service.buildSingle(mockModel as any, null);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });

    it("should throw HttpException 404 when record is undefined", async () => {
      const mockBuilder = createMockBuilder("items", "/items");
      mockSerialiserFactory.create.mockReturnValue(mockBuilder as any);

      await expect(service.buildSingle(mockModel as any, undefined)).rejects.toThrow(HttpException);
    });
  });

  describe("buildList", () => {
    const mockModel = { serialiser: class MockSerialiser {} };

    it("should build a list JSON:API response", async () => {
      const mockRecords = [
        { id: "1", name: "Item 1", description: "Desc 1" },
        { id: "2", name: "Item 2", description: "Desc 2" },
      ];

      const mockBuilder = createMockBuilder("items", "/items");
      mockSerialiserFactory.create.mockReturnValue(mockBuilder as any);

      const result = await service.buildList(mockModel as any, mockRecords);

      expect(mockSerialiserFactory.create).toHaveBeenCalledWith(mockModel);
      expect(result).toHaveProperty("links");
      expect(result).toHaveProperty("data");
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(2);
      expect(result.data[0].type).toBe("items");
      expect(result.data[0].id).toBe("1");
      expect(result.data[1].id).toBe("2");
    });

    it("should use requestUrl from CLS if available", async () => {
      const mockRecords = [{ id: "1", name: "Item 1", description: "Desc 1" }];
      const requestUrl = "https://api.example.com/items?filter[status]=active";

      const mockBuilder = createMockBuilder("items", "/items");
      mockSerialiserFactory.create.mockReturnValue(mockBuilder as any);
      mockClsService.get.mockImplementation((key: string) => {
        if (key === "requestUrl") return requestUrl;
        return undefined;
      });

      const result = await service.buildList(mockModel as any, mockRecords);

      expect(result.links.self).toBe(requestUrl);
    });

    it("should fallback to model endpoint when requestUrl is not available", async () => {
      const mockRecords = [{ id: "1", name: "Item 1", description: "Desc 1" }];

      const mockBuilder = createMockBuilder("items", "/items");
      mockSerialiserFactory.create.mockReturnValue(mockBuilder as any);
      mockClsService.get.mockReturnValue(undefined);

      const result = await service.buildList(mockModel as any, mockRecords);

      expect(result.links.self).toBe("https://api.example.com/items");
    });

    it("should handle empty array", async () => {
      const mockBuilder = createMockBuilder("items", "/items");
      mockSerialiserFactory.create.mockReturnValue(mockBuilder as any);

      const result = await service.buildList(mockModel as any, []);

      expect(result.data).toEqual([]);
    });
  });

  describe("serialise", () => {
    it("should serialise a single object", async () => {
      const data = { id: "123", name: "Test", description: "Test Desc" };
      const builder = {
        type: "items",
        id: "id",
        attributes: {
          name: "name",
          description: "description",
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/items/123");

      expect(result.links.self).toBe("https://api.example.com/items/123");
      expect(result.data.type).toBe("items");
      expect(result.data.id).toBe("123");
      expect(result.data.attributes.name).toBe("Test");
      expect(result.data.attributes.description).toBe("Test Desc");
    });

    it("should serialise an array of objects", async () => {
      const data = [
        { id: "1", name: "Item 1", description: "Desc 1" },
        { id: "2", name: "Item 2", description: "Desc 2" },
      ];
      const builder = {
        type: "items",
        id: "id",
        attributes: {
          name: "name",
          description: "description",
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/items");

      expect(result.links.self).toBe("https://api.example.com/items");
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(2);
    });

    it("should include meta.total from CLS queryTotal", async () => {
      const data = { id: "123", name: "Test", description: "Test Desc" };
      const builder = {
        type: "items",
        id: "id",
        attributes: { name: "name" },
      };

      mockClsService.get.mockImplementation((key: string) => {
        if (key === "queryTotal") return 42;
        return undefined;
      });

      const result = await service.serialise(data, builder as any, "https://api.example.com/items");

      expect(result.meta).toBeDefined();
      expect(result.meta.total).toBe(42);
    });

    it("should use paginator total if CLS queryTotal is not available", async () => {
      const data = { id: "123", name: "Test", description: "Test Desc" };
      const builder = {
        type: "items",
        id: "id",
        attributes: { name: "name" },
      };
      const paginator = new JsonApiPaginator();
      paginator.total = 100;

      mockClsService.get.mockReturnValue(undefined);

      const result = await service.serialise(data, builder as any, "https://api.example.com/items", paginator);

      expect(result.meta).toBeDefined();
      expect(result.meta.total).toBe(100);
    });

    it("should handle function-based id in builder", async () => {
      const data = { uuid: "abc-123", name: "Test", description: "Test Desc" };
      const builder = {
        type: "items",
        id: (data: any) => data.uuid,
        attributes: { name: "name" },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/items");

      expect(result.data.id).toBe("abc-123");
    });

    it("should handle function-based attributes in builder", async () => {
      const data = { id: "123", firstName: "John", lastName: "Doe" };
      const builder = {
        type: "users",
        id: "id",
        attributes: {
          fullName: async (data: any) => `${data.firstName} ${data.lastName}`,
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/users");

      expect(result.data.attributes.fullName).toBe("John Doe");
    });

    it("should handle meta in builder", async () => {
      const data = { id: "123", name: "Test", createdAt: "2024-01-01" };
      const builder = {
        type: "items",
        id: "id",
        attributes: { name: "name" },
        meta: {
          createdAt: "createdAt",
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/items");

      expect(result.data.meta).toBeDefined();
      expect(result.data.meta.createdAt).toBe("2024-01-01");
    });

    it("should handle function-based meta in builder", async () => {
      const data = { id: "123", name: "Test", timestamp: 1704067200 };
      const builder = {
        type: "items",
        id: "id",
        attributes: { name: "name" },
        meta: {
          formattedDate: async (data: any) => new Date(data.timestamp * 1000).toISOString(),
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/items");

      expect(result.data.meta).toBeDefined();
      expect(result.data.meta.formattedDate).toBe("2024-01-01T00:00:00.000Z");
    });

    it("should include links.self in data when builder has links", async () => {
      const data = { id: "123", name: "Test" };
      const builder = {
        type: "items",
        id: "id",
        attributes: { name: "name" },
        links: {
          self: (data: any) => `https://api.example.com/items/${data.id}`,
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/items");

      expect(result.data.links).toBeDefined();
      expect(result.data.links.self).toBe("https://api.example.com/items/123");
    });
  });

  describe("serialise with pagination", () => {
    it("should generate pagination links when paginator is provided", async () => {
      // Create enough data to trigger pagination (more than default size)
      const data = Array.from({ length: 26 }, (_, i) => ({
        id: `${i + 1}`,
        name: `Item ${i + 1}`,
      }));
      const builder = {
        type: "items",
        id: "id",
        attributes: { name: "name" },
      };
      const paginator = new JsonApiPaginator();

      const result = await service.serialise(data, builder as any, "https://api.example.com/items", paginator);

      expect(result.links).toBeDefined();
      expect(result.links.self).toBeDefined();
    });

    it("should remove links when URL is empty", async () => {
      const data = [{ id: "1", name: "Item 1" }];
      const builder = {
        type: "items",
        id: "id",
        attributes: { name: "name" },
      };
      const paginator = new JsonApiPaginator();

      const result = await service.serialise(data, builder as any, "", paginator);

      expect(result.links).toBeUndefined();
    });

    it("should filter included fields based on sparse fieldsets", async () => {
      const data = { id: "123", name: "Test", description: "Test Desc", secret: "hidden" };
      const builder = {
        type: "items",
        id: "id",
        attributes: {
          name: "name",
          description: "description",
          secret: "secret",
        },
      };
      const paginator = new JsonApiPaginator("fields[items]=name,description");

      const result = await service.serialise(data, builder as any, "https://api.example.com/items", paginator);

      expect(result.data.attributes.name).toBe("Test");
      expect(result.data.attributes.description).toBe("Test Desc");
      expect(result.data.attributes.secret).toBeUndefined();
    });
  });

  describe("serialise with relationships", () => {
    it("should handle resourceIdentifier relationships", async () => {
      const data = { id: "123", name: "Test", authorId: "author-456" };
      const builder = {
        type: "posts",
        id: "id",
        attributes: { name: "name" },
        relationships: {
          author: {
            resourceIdentifier: {
              type: "users",
              id: "authorId",
            },
          },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      expect(result.data.relationships).toBeDefined();
      expect(result.data.relationships.author.data.type).toBe("users");
      expect(result.data.relationships.author.data.id).toBe("author-456");
    });

    it("should handle function-based resourceIdentifier id", async () => {
      const data = { id: "123", name: "Test", author: { uuid: "author-789" } };
      const builder = {
        type: "posts",
        id: "id",
        attributes: { name: "name" },
        relationships: {
          author: {
            resourceIdentifier: {
              type: "users",
              id: (data: any) => data.author.uuid,
            },
          },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      expect(result.data.relationships.author.data.id).toBe("author-789");
    });

    it("should handle related links in relationships", async () => {
      const data = { id: "123", name: "Test", authorId: "author-456" };
      const builder = {
        type: "posts",
        id: "id",
        attributes: { name: "name" },
        relationships: {
          author: {
            resourceIdentifier: {
              type: "users",
              id: "authorId",
            },
            links: {
              related: (data: any) => `https://api.example.com/users/${data.authorId}`,
            },
          },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      expect(result.data.relationships.author.links).toBeDefined();
      expect(result.data.relationships.author.links.related).toBe("https://api.example.com/users/author-456");
    });

    it("should handle named relationships", async () => {
      const data = { id: "123", name: "Test", authorId: "author-456" };
      const builder = {
        type: "posts",
        id: "id",
        attributes: { name: "name" },
        relationships: {
          author: {
            name: "writer",
            resourceIdentifier: {
              type: "users",
              id: "authorId",
            },
          },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      expect(result.data.relationships.writer).toBeDefined();
      expect(result.data.relationships.author).toBeUndefined();
    });

    it("should handle empty relationships object", async () => {
      const data = { id: "123", name: "Test" };
      const builder = {
        type: "items",
        id: "id",
        attributes: { name: "name" },
        relationships: {},
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/items");

      expect(result.data.relationships).toBeUndefined();
    });
  });

  describe("serialise with included resources", () => {
    it("should include related resources when data is present", async () => {
      const nestedBuilder = {
        type: "users",
        id: "id",
        attributes: { name: "name" },
        create: vi.fn().mockReturnValue({
          type: "users",
          id: "id",
          attributes: { name: "name" },
        }),
      };

      const data = {
        id: "123",
        title: "Test Post",
        author: { id: "456", name: "John Doe" },
      };

      const builder = {
        type: "posts",
        id: "id",
        attributes: { title: "title" },
        relationships: {
          author: {
            data: nestedBuilder,
          },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      expect(result.included).toBeDefined();
      expect(result.included.length).toBeGreaterThan(0);
      expect(result.included[0].type).toBe("users");
      expect(result.included[0].id).toBe("456");
    });

    it("should handle excluded relationships (not added to included)", async () => {
      const nestedBuilder = {
        type: "users",
        id: "id",
        attributes: { name: "name" },
        create: vi.fn().mockReturnValue({
          type: "users",
          id: "id",
          attributes: { name: "name" },
        }),
      };

      const data = {
        id: "123",
        title: "Test Post",
        author: { id: "456", name: "John Doe" },
      };

      const builder = {
        type: "posts",
        id: "id",
        attributes: { title: "title" },
        relationships: {
          author: {
            data: nestedBuilder,
            excluded: true,
          },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      expect(result.included).toBeUndefined();
    });

    it("should filter included types based on paginator includeSpecified", async () => {
      const userBuilder = {
        type: "users",
        id: "id",
        attributes: { name: "name" },
        create: vi.fn().mockReturnValue({
          type: "users",
          id: "id",
          attributes: { name: "name" },
        }),
      };

      const categoryBuilder = {
        type: "categories",
        id: "id",
        attributes: { name: "name" },
        create: vi.fn().mockReturnValue({
          type: "categories",
          id: "id",
          attributes: { name: "name" },
        }),
      };

      const data = {
        id: "123",
        title: "Test Post",
        author: { id: "456", name: "John Doe" },
        category: { id: "789", name: "Tech" },
      };

      const builder = {
        type: "posts",
        id: "id",
        attributes: { title: "title" },
        relationships: {
          author: { data: userBuilder },
          category: { data: categoryBuilder },
        },
      };

      // Only include users, not categories
      const paginator = new JsonApiPaginator("include=users");

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts", paginator);

      expect(result.included).toBeDefined();
      const includedTypes = result.included.map((i: any) => i.type);
      expect(includedTypes).toContain("users");
      expect(includedTypes).not.toContain("categories");
    });

    it("should deduplicate included resources", async () => {
      const userBuilder = {
        type: "users",
        id: "id",
        attributes: { name: "name" },
        create: vi.fn().mockReturnValue({
          type: "users",
          id: "id",
          attributes: { name: "name" },
        }),
      };

      const data = [
        { id: "1", title: "Post 1", author: { id: "456", name: "John" } },
        { id: "2", title: "Post 2", author: { id: "456", name: "John" } }, // Same author
      ];

      const builder = {
        type: "posts",
        id: "id",
        attributes: { title: "title" },
        relationships: {
          author: { data: userBuilder },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      expect(result.included).toBeDefined();
      // Should only have one user with id 456, not duplicates
      const userIncludes = result.included.filter((i: any) => i.type === "users" && i.id === "456");
      expect(userIncludes.length).toBe(1);
    });
  });

  describe("serialise with array relationships", () => {
    it("should handle array relationships", async () => {
      const tagBuilder = {
        type: "tags",
        id: "id",
        attributes: { name: "name" },
        create: vi.fn().mockReturnValue({
          type: "tags",
          id: "id",
          attributes: { name: "name" },
        }),
      };

      const data = {
        id: "123",
        title: "Test Post",
        tags: [
          { id: "t1", name: "JavaScript" },
          { id: "t2", name: "TypeScript" },
        ],
      };

      const builder = {
        type: "posts",
        id: "id",
        attributes: { title: "title" },
        relationships: {
          tags: { data: tagBuilder },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      expect(result.data.relationships.tags.data).toBeInstanceOf(Array);
      expect(result.data.relationships.tags.data.length).toBe(2);
      expect(result.data.relationships.tags.data[0].type).toBe("tags");
      expect(result.data.relationships.tags.data[0].id).toBe("t1");
    });

    it("should handle forceSingle on array relationships", async () => {
      const userBuilder = {
        type: "users",
        id: "id",
        attributes: { name: "name" },
        create: vi.fn().mockReturnValue({
          type: "users",
          id: "id",
          attributes: { name: "name" },
        }),
      };

      const data = {
        id: "123",
        title: "Test Post",
        primaryAuthor: [{ id: "456", name: "John" }],
      };

      const builder = {
        type: "posts",
        id: "id",
        attributes: { title: "title" },
        relationships: {
          primaryAuthor: {
            data: userBuilder,
            forceSingle: true,
          },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      // Should be a single object, not array
      expect(result.data.relationships.primaryAuthor.data).not.toBeInstanceOf(Array);
      expect(result.data.relationships.primaryAuthor.data.type).toBe("users");
    });
  });

  describe("serialise with relationship meta", () => {
    it("should include relationship meta when relationship data exists", async () => {
      const userBuilder = {
        type: "users",
        id: "id",
        attributes: { name: "name" },
        create: vi.fn().mockReturnValue({
          type: "users",
          id: "id",
          attributes: { name: "name" },
        }),
      };

      const data = { id: "123", title: "Test Post", author: { id: "456", name: "John" }, authorRole: "editor" };
      const builder = {
        type: "posts",
        id: "id",
        attributes: { title: "title" },
        relationships: {
          author: {
            data: userBuilder,
            meta: {
              role: "authorRole",
            },
          },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      expect(result.data.relationships.author.meta).toBeDefined();
      expect(result.data.relationships.author.meta.role).toBe("editor");
    });

    it("should handle function-based relationship meta", async () => {
      const userBuilder = {
        type: "users",
        id: "id",
        attributes: { name: "name" },
        create: vi.fn().mockReturnValue({
          type: "users",
          id: "id",
          attributes: { name: "name" },
        }),
      };

      const data = {
        id: "123",
        title: "Test Post",
        author: { id: "456", name: "John" },
        permissions: ["read", "write"],
      };
      const builder = {
        type: "posts",
        id: "id",
        attributes: { title: "title" },
        relationships: {
          author: {
            data: userBuilder,
            meta: {
              permissionCount: async (data: any) => data.permissions.length,
            },
          },
        },
      };

      const result = await service.serialise(data, builder as any, "https://api.example.com/posts");

      expect(result.data.relationships.author.meta).toBeDefined();
      expect(result.data.relationships.author.meta.permissionCount).toBe(2);
    });
  });
});
