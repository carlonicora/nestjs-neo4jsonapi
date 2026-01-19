import { describe, it, expect } from "vitest";
import { createRequestSchemas } from "../request-schema.factory";
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

describe("request-schema.factory", () => {
  describe("createRequestSchemas", () => {
    it("should return createRequest, updateRequest, and patchRequest schemas", () => {
      const schemas = createRequestSchemas(mockDescriptor);

      expect(schemas.createRequest).toBeDefined();
      expect(schemas.updateRequest).toBeDefined();
      expect(schemas.patchRequest).toBeDefined();
      expect(schemas.schemaName).toBe("Photographs");
    });

    describe("createRequest schema (POST)", () => {
      it("should have data as required", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        expect(schemas.createRequest.required).toContain("data");
      });

      it("should have type and attributes as required in data", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.createRequest.properties?.data as any;
        expect(dataProperty.required).toContain("type");
        expect(dataProperty.required).toContain("attributes");
      });

      it("should not require id in createRequest", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.createRequest.properties?.data as any;
        expect(dataProperty.required).not.toContain("id");
      });

      it("should have id as optional with description", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.createRequest.properties?.data as any;
        expect(dataProperty.properties?.id).toBeDefined();
        expect(dataProperty.properties?.id.description).toContain("Optional");
      });

      it("should include required fields in attributes", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.createRequest.properties?.data as any;
        const attributes = dataProperty.properties?.attributes;
        expect(attributes.required).toContain("title");
      });
    });

    describe("updateRequest schema (PUT)", () => {
      it("should require type, id, and attributes in data", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.updateRequest.properties?.data as any;
        expect(dataProperty.required).toContain("type");
        expect(dataProperty.required).toContain("id");
        expect(dataProperty.required).toContain("attributes");
      });

      it("should have id property with must-match description", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.updateRequest.properties?.data as any;
        expect(dataProperty.properties?.id.description).toContain("must match URL");
      });
    });

    describe("patchRequest schema (PATCH)", () => {
      it("should require type and id but not attributes in data", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.patchRequest.properties?.data as any;
        expect(dataProperty.required).toContain("type");
        expect(dataProperty.required).toContain("id");
        expect(dataProperty.required).not.toContain("attributes");
      });

      it("should have all attributes as optional", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.patchRequest.properties?.data as any;
        const attributes = dataProperty.properties?.attributes;
        expect(attributes.required).toBeUndefined();
      });
    });

    describe("writable fields", () => {
      it("should exclude computed fields from writable fields", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.createRequest.properties?.data as any;
        const attributes = dataProperty.properties?.attributes;
        expect(attributes.properties?.fullName).toBeUndefined();
      });

      it("should include regular fields in writable fields", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.createRequest.properties?.data as any;
        const attributes = dataProperty.properties?.attributes;
        expect(attributes.properties?.title).toBeDefined();
        expect(attributes.properties?.description).toBeDefined();
      });
    });

    describe("relationships in request", () => {
      it("should include relationships in request body", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.createRequest.properties?.data as any;
        expect(dataProperty.properties?.relationships).toBeDefined();
      });

      it("should have to-one relationships reference ResourceIdentifier", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.createRequest.properties?.data as any;
        const relationships = dataProperty.properties?.relationships as any;
        expect(relationships.properties?.author.properties?.data.$ref).toBe(
          "#/components/schemas/JsonApiResourceIdentifier",
        );
      });

      it("should have to-many relationships as array of ResourceIdentifiers", () => {
        const schemas = createRequestSchemas(mockDescriptor);
        const dataProperty = schemas.createRequest.properties?.data as any;
        const relationships = dataProperty.properties?.relationships as any;
        expect(relationships.properties?.tags.properties?.data.type).toBe("array");
        expect(relationships.properties?.tags.properties?.data.items.$ref).toBe(
          "#/components/schemas/JsonApiResourceIdentifier",
        );
      });
    });
  });
});
