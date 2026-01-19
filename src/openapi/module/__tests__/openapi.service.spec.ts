import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpenApiService } from "../openapi.service";
import { EntityDescriptor, RelationshipDef } from "../../../common/interfaces/entity.schema.interface";

// Mock Logger
vi.mock("@nestjs/common", async () => {
  const actual = await vi.importActual("@nestjs/common");
  return {
    ...actual,
    Logger: class MockLogger {
      log = vi.fn();
      debug = vi.fn();
      warn = vi.fn();
      error = vi.fn();
    },
  };
});

// Mock entity descriptor for testing
const mockPhotographDescriptor: EntityDescriptor<any, Record<string, RelationshipDef>> = {
  model: {
    type: "photographs",
    endpoint: "photographs",
    nodeName: "photograph",
    labelName: "Photograph",
    entity: {} as any,
    mapper: () => ({}) as any,
    childrenTokens: [],
  },
  isCompanyScoped: true,
  relationships: {
    author: {
      model: {
        type: "users",
        endpoint: "users",
        nodeName: "user",
        labelName: "User",
      },
      direction: "out",
      relationship: "CREATED_BY",
      cardinality: "one",
    },
  },
  relationshipKeys: {
    author: "author",
  },
  fieldNames: ["title", "description"],
  stringFields: ["title", "description"],
  requiredFields: ["title"],
  fieldDefaults: {},
  fields: {
    title: { type: "string", required: true },
    description: { type: "string" },
  },
  computed: {},
  injectServices: [],
  constraints: [],
  indexes: [],
  fulltextIndexName: "photographs_fulltext",
  defaultOrderBy: "createdAt",
};

const mockRollDescriptor: EntityDescriptor<any, Record<string, RelationshipDef>> = {
  model: {
    type: "rolls",
    endpoint: "rolls",
    nodeName: "roll",
    labelName: "Roll",
    entity: {} as any,
    mapper: () => ({}) as any,
    childrenTokens: [],
  },
  isCompanyScoped: true,
  relationships: {},
  relationshipKeys: {},
  fieldNames: ["name", "date"],
  stringFields: ["name"],
  requiredFields: ["name"],
  fieldDefaults: {},
  fields: {
    name: { type: "string", required: true },
    date: { type: "datetime" },
  },
  computed: {},
  injectServices: [],
  constraints: [],
  indexes: [],
  fulltextIndexName: "rolls_fulltext",
  defaultOrderBy: "createdAt",
};

describe("OpenApiService", () => {
  let service: OpenApiService;

  beforeEach(() => {
    service = new OpenApiService();
  });

  describe("registerEntity", () => {
    it("should register an entity descriptor", () => {
      service.registerEntity(mockPhotographDescriptor);

      expect(service.isRegistered("photographs")).toBe(true);
      expect(service.getRegisteredCount()).toBe(1);
    });

    it("should skip duplicate registration", () => {
      service.registerEntity(mockPhotographDescriptor);
      service.registerEntity(mockPhotographDescriptor);

      expect(service.getRegisteredCount()).toBe(1);
    });

    it("should add entity type to registered types", () => {
      service.registerEntity(mockPhotographDescriptor);

      const types = service.getRegisteredTypes();
      expect(types).toContain("photographs");
    });

    it("should invalidate cache when entity registered", () => {
      service.registerEntity(mockPhotographDescriptor);
      const schemas1 = service.getAllSchemas();

      service.registerEntity(mockRollDescriptor);
      const schemas2 = service.getAllSchemas();

      // Should have more schemas after second registration
      expect(Object.keys(schemas2).length).toBeGreaterThan(Object.keys(schemas1).length);
    });
  });

  describe("registerEntities", () => {
    it("should register multiple entity descriptors", () => {
      service.registerEntities([mockPhotographDescriptor, mockRollDescriptor]);

      expect(service.getRegisteredCount()).toBe(2);
      expect(service.isRegistered("photographs")).toBe(true);
      expect(service.isRegistered("rolls")).toBe(true);
    });

    it("should handle empty array", () => {
      service.registerEntities([]);
      expect(service.getRegisteredCount()).toBe(0);
    });
  });

  describe("getAllSchemas", () => {
    it("should return base JSON:API schemas", () => {
      const schemas = service.getAllSchemas();

      expect(schemas.JsonApiResourceIdentifier).toBeDefined();
      expect(schemas.JsonApiRelationship).toBeDefined();
      expect(schemas.JsonApiLinks).toBeDefined();
      expect(schemas.JsonApiPaginationMeta).toBeDefined();
    });

    it("should return error response schemas", () => {
      const schemas = service.getAllSchemas();

      expect(schemas.JsonApiErrorSource).toBeDefined();
      expect(schemas.JsonApiError).toBeDefined();
      expect(schemas.JsonApiErrorResponse).toBeDefined();
      expect(schemas.JsonApi400ErrorResponse).toBeDefined();
      expect(schemas.JsonApi401ErrorResponse).toBeDefined();
      expect(schemas.JsonApi404ErrorResponse).toBeDefined();
      expect(schemas.JsonApi500ErrorResponse).toBeDefined();
    });

    it("should return entity schemas when registered", () => {
      service.registerEntity(mockPhotographDescriptor);
      const schemas = service.getAllSchemas();

      expect(schemas.Photographs).toBeDefined();
      expect(schemas.PhotographsResponse).toBeDefined();
      expect(schemas.PhotographsCollectionResponse).toBeDefined();
      expect(schemas.CreatePhotographsRequest).toBeDefined();
      expect(schemas.UpdatePhotographsRequest).toBeDefined();
      expect(schemas.PatchPhotographsRequest).toBeDefined();
    });

    it("should cache schemas", () => {
      service.registerEntity(mockPhotographDescriptor);

      const schemas1 = service.getAllSchemas();
      const schemas2 = service.getAllSchemas();

      expect(schemas1).toBe(schemas2); // Same reference = cached
    });

    it("should return schemas for multiple registered entities", () => {
      service.registerEntities([mockPhotographDescriptor, mockRollDescriptor]);
      const schemas = service.getAllSchemas();

      expect(schemas.Photographs).toBeDefined();
      expect(schemas.Rolls).toBeDefined();
      expect(schemas.PhotographsResponse).toBeDefined();
      expect(schemas.RollsResponse).toBeDefined();
    });
  });

  describe("getEntitySchemas", () => {
    it("should return registered entity schemas", () => {
      service.registerEntity(mockPhotographDescriptor);

      const result = service.getEntitySchemas("photographs");

      expect(result).toBeDefined();
      expect(result?.descriptor).toBe(mockPhotographDescriptor);
      expect(result?.entitySchemas).toBeDefined();
      expect(result?.requestSchemas).toBeDefined();
    });

    it("should return undefined for unregistered type", () => {
      const result = service.getEntitySchemas("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("getRegisteredTypes", () => {
    it("should return empty array when no entities registered", () => {
      const types = service.getRegisteredTypes();
      expect(types).toEqual([]);
    });

    it("should return all registered types", () => {
      service.registerEntities([mockPhotographDescriptor, mockRollDescriptor]);

      const types = service.getRegisteredTypes();

      expect(types).toContain("photographs");
      expect(types).toContain("rolls");
      expect(types.length).toBe(2);
    });
  });

  describe("isRegistered", () => {
    it("should return true for registered type", () => {
      service.registerEntity(mockPhotographDescriptor);
      expect(service.isRegistered("photographs")).toBe(true);
    });

    it("should return false for unregistered type", () => {
      expect(service.isRegistered("photographs")).toBe(false);
    });
  });

  describe("getRegisteredCount", () => {
    it("should return 0 when no entities registered", () => {
      expect(service.getRegisteredCount()).toBe(0);
    });

    it("should return correct count", () => {
      service.registerEntities([mockPhotographDescriptor, mockRollDescriptor]);
      expect(service.getRegisteredCount()).toBe(2);
    });
  });

  describe("schema structure", () => {
    it("should generate resource schema with correct structure", () => {
      service.registerEntity(mockPhotographDescriptor);
      const schemas = service.getAllSchemas();

      const photographSchema = schemas.Photographs;
      expect(photographSchema.type).toBe("object");
      expect(photographSchema.properties?.type).toBeDefined();
      expect(photographSchema.properties?.id).toBeDefined();
      expect(photographSchema.properties?.attributes).toBeDefined();
    });

    it("should generate request schema with correct structure", () => {
      service.registerEntity(mockPhotographDescriptor);
      const schemas = service.getAllSchemas();

      const createSchema = schemas.CreatePhotographsRequest;
      expect(createSchema.type).toBe("object");
      expect(createSchema.required).toContain("data");
      expect(createSchema.properties?.data).toBeDefined();
    });

    it("should generate response schema with correct structure", () => {
      service.registerEntity(mockPhotographDescriptor);
      const schemas = service.getAllSchemas();

      const responseSchema = schemas.PhotographsResponse;
      expect(responseSchema.type).toBe("object");
      expect(responseSchema.required).toContain("data");
    });

    it("should generate collection response schema with array data", () => {
      service.registerEntity(mockPhotographDescriptor);
      const schemas = service.getAllSchemas();

      const collectionSchema = schemas.PhotographsCollectionResponse;
      const dataProperty = collectionSchema.properties?.data as any;
      expect(dataProperty.type).toBe("array");
    });
  });
});
