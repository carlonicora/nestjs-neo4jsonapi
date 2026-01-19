import { describe, it, expect } from "vitest";
import { createEntitySchemas } from "../entity-schema.factory";
import { EntityDescriptor, RelationshipDef } from "../../../common/interfaces/entity.schema.interface";

// Mock entity descriptor for testing
const mockDescriptor: EntityDescriptor<any, Record<string, RelationshipDef>> = {
  model: {
    type: "photographs",
    endpoint: "photographs",
    nodeName: "photograph",
    labelName: "Photograph",
    childrenTokens: [],
    mapper: {} as any,
  },
  isCompanyScoped: true,
  relationships: {
    author: {
      model: {
        type: "users",
        endpoint: "users",
        nodeName: "user",
        labelName: "User",
        childrenTokens: [],
        mapper: {} as any,
      },
      direction: "out",
      relationship: "CREATED_BY",
      cardinality: "one",
    },
    tags: {
      model: {
        type: "tags",
        endpoint: "tags",
        nodeName: "tag",
        labelName: "Tag",
        childrenTokens: [],
        mapper: {} as any,
      },
      direction: "out",
      relationship: "HAS_TAG",
      cardinality: "many",
    },
  },
  relationshipKeys: {
    author: "author",
    tags: "tags",
  },
  fieldNames: ["title", "description", "createdAt", "isPublic"],
  stringFields: ["title", "description"],
  requiredFields: ["title"],
  fieldDefaults: {},
  fields: {
    title: { type: "string", required: true },
    description: { type: "string" },
    createdAt: { type: "datetime" },
    isPublic: { type: "boolean", default: false },
  },
  computed: {
    fullName: { compute: () => "test" },
  },
  injectServices: [],
  constraints: [],
  indexes: [],
  fulltextIndexName: "photograph_search_index",
  defaultOrderBy: "createdAt DESC",
};

describe("entity-schema.factory", () => {
  describe("createEntitySchemas", () => {
    it("should return resource, singleResponse, and collectionResponse schemas", () => {
      const schemas = createEntitySchemas(mockDescriptor);

      expect(schemas.resource).toBeDefined();
      expect(schemas.singleResponse).toBeDefined();
      expect(schemas.collectionResponse).toBeDefined();
      expect(schemas.schemaName).toBe("Photographs");
    });

    describe("resource schema", () => {
      it("should have type and id as required fields", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        expect(schemas.resource.required).toContain("type");
        expect(schemas.resource.required).toContain("id");
      });

      it("should have type property with correct example", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const typeProperty = schemas.resource.properties?.type as any;
        expect(typeProperty.example).toBe("photographs");
      });

      it("should include attributes in properties", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        expect(schemas.resource.properties?.attributes).toBeDefined();
      });

      it("should include relationships in properties", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        expect(schemas.resource.properties?.relationships).toBeDefined();
      });

      it("should include links in properties", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        expect(schemas.resource.properties?.links).toBeDefined();
      });

      it("should have example with correct type and id", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const example = schemas.resource.example as any;
        expect(example.type).toBe("photographs");
        expect(example.id).toBeDefined();
      });
    });

    describe("attributes schema", () => {
      it("should map string fields to string type", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const attributes = schemas.resource.properties?.attributes as any;
        expect(attributes.properties?.title?.type).toBe("string");
        expect(attributes.properties?.description?.type).toBe("string");
      });

      it("should map datetime fields to string with date-time format", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const attributes = schemas.resource.properties?.attributes as any;
        expect(attributes.properties?.createdAt?.type).toBe("string");
        expect(attributes.properties?.createdAt?.format).toBe("date-time");
      });

      it("should map boolean fields to boolean type", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const attributes = schemas.resource.properties?.attributes as any;
        expect(attributes.properties?.isPublic?.type).toBe("boolean");
      });

      it("should include required fields in required array", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const attributes = schemas.resource.properties?.attributes as any;
        expect(attributes.required).toContain("title");
      });

      it("should include computed fields with description", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const attributes = schemas.resource.properties?.attributes as any;
        expect(attributes.properties?.fullName).toBeDefined();
        expect(attributes.properties?.fullName?.description).toContain("Computed");
      });
    });

    describe("relationships schema", () => {
      it("should include to-one relationships with nullable data", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const relationships = schemas.resource.properties?.relationships as any;
        expect(relationships.properties?.author).toBeDefined();
        expect(relationships.properties?.author.properties?.data?.oneOf).toBeDefined();
      });

      it("should include to-many relationships with array data", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const relationships = schemas.resource.properties?.relationships as any;
        expect(relationships.properties?.tags).toBeDefined();
        expect(relationships.properties?.tags.properties?.data?.type).toBe("array");
      });

      it("should include relationship descriptions with cardinality", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const relationships = schemas.resource.properties?.relationships as any;
        expect(relationships.properties?.author.description).toContain("one");
        expect(relationships.properties?.tags.description).toContain("many");
      });
    });

    describe("singleResponse schema", () => {
      it("should have data as required", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        expect(schemas.singleResponse.required).toContain("data");
      });

      it("should reference the entity schema for data", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const dataProperty = schemas.singleResponse.properties?.data as any;
        expect(dataProperty.$ref).toBe("#/components/schemas/Photographs");
      });

      it("should include links and included properties", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        expect(schemas.singleResponse.properties?.links).toBeDefined();
        expect(schemas.singleResponse.properties?.included).toBeDefined();
      });
    });

    describe("collectionResponse schema", () => {
      it("should have data as array", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const dataProperty = schemas.collectionResponse.properties?.data as any;
        expect(dataProperty.type).toBe("array");
      });

      it("should reference entity schema in items", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const dataProperty = schemas.collectionResponse.properties?.data as any;
        expect(dataProperty.items.$ref).toBe("#/components/schemas/Photographs");
      });

      it("should include meta for pagination", () => {
        const schemas = createEntitySchemas(mockDescriptor);
        const metaProperty = schemas.collectionResponse.properties?.meta as any;
        expect(metaProperty.$ref).toBe("#/components/schemas/JsonApiPaginationMeta");
      });
    });
  });
});
