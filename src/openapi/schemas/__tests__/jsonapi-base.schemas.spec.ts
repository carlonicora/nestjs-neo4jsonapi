import { describe, it, expect } from "vitest";
import {
  JsonApiResourceIdentifierSchema,
  JsonApiRelationshipSchema,
  JsonApiLinksSchema,
  JsonApiPaginationMetaSchema,
  createSingleResourceResponseSchema,
  createCollectionResponseSchema,
  getBaseJsonApiSchemas,
} from "../jsonapi-base.schemas";

describe("jsonapi-base.schemas", () => {
  describe("JsonApiResourceIdentifierSchema", () => {
    it("should have type and id as required fields", () => {
      expect(JsonApiResourceIdentifierSchema.required).toContain("type");
      expect(JsonApiResourceIdentifierSchema.required).toContain("id");
    });

    it("should have type property as string", () => {
      expect(JsonApiResourceIdentifierSchema.properties?.type).toBeDefined();
      const typeProperty = JsonApiResourceIdentifierSchema.properties?.type as any;
      expect(typeProperty.type).toBe("string");
    });

    it("should have id property as string", () => {
      expect(JsonApiResourceIdentifierSchema.properties?.id).toBeDefined();
      const idProperty = JsonApiResourceIdentifierSchema.properties?.id as any;
      expect(idProperty.type).toBe("string");
    });

    it("should be an object type", () => {
      expect(JsonApiResourceIdentifierSchema.type).toBe("object");
    });
  });

  describe("JsonApiRelationshipSchema", () => {
    it("should have data property with oneOf for single, array, or null", () => {
      expect(JsonApiRelationshipSchema.properties?.data).toBeDefined();
      const dataProperty = JsonApiRelationshipSchema.properties?.data as any;
      expect(dataProperty.oneOf).toBeDefined();
      expect(dataProperty.oneOf.length).toBeGreaterThanOrEqual(3);
    });

    it("should have links property with self and related", () => {
      expect(JsonApiRelationshipSchema.properties?.links).toBeDefined();
      const linksProperty = JsonApiRelationshipSchema.properties?.links as any;
      expect(linksProperty.properties?.self).toBeDefined();
      expect(linksProperty.properties?.related).toBeDefined();
    });

    it("should have meta property with additionalProperties", () => {
      expect(JsonApiRelationshipSchema.properties?.meta).toBeDefined();
      const metaProperty = JsonApiRelationshipSchema.properties?.meta as any;
      expect(metaProperty.additionalProperties).toBe(true);
    });
  });

  describe("JsonApiLinksSchema", () => {
    it("should have self link property", () => {
      expect(JsonApiLinksSchema.properties?.self).toBeDefined();
      const selfProperty = JsonApiLinksSchema.properties?.self as any;
      expect(selfProperty.format).toBe("uri");
    });

    it("should have pagination links (first, prev, next, last)", () => {
      expect(JsonApiLinksSchema.properties?.first).toBeDefined();
      expect(JsonApiLinksSchema.properties?.prev).toBeDefined();
      expect(JsonApiLinksSchema.properties?.next).toBeDefined();
      expect(JsonApiLinksSchema.properties?.last).toBeDefined();
    });

    it("should allow null for prev and next links", () => {
      const prevProperty = JsonApiLinksSchema.properties?.prev as any;
      const nextProperty = JsonApiLinksSchema.properties?.next as any;

      expect(prevProperty.oneOf).toBeDefined();
      expect(prevProperty.oneOf.some((opt: any) => opt.type === "null")).toBe(true);
      expect(nextProperty.oneOf).toBeDefined();
      expect(nextProperty.oneOf.some((opt: any) => opt.type === "null")).toBe(true);
    });
  });

  describe("JsonApiPaginationMetaSchema", () => {
    it("should have total property as integer", () => {
      expect(JsonApiPaginationMetaSchema.properties?.total).toBeDefined();
      const totalProperty = JsonApiPaginationMetaSchema.properties?.total as any;
      expect(totalProperty.type).toBe("integer");
    });

    it("should have offset property as integer", () => {
      expect(JsonApiPaginationMetaSchema.properties?.offset).toBeDefined();
      const offsetProperty = JsonApiPaginationMetaSchema.properties?.offset as any;
      expect(offsetProperty.type).toBe("integer");
    });

    it("should have size property as integer", () => {
      expect(JsonApiPaginationMetaSchema.properties?.size).toBeDefined();
      const sizeProperty = JsonApiPaginationMetaSchema.properties?.size as any;
      expect(sizeProperty.type).toBe("integer");
    });
  });

  describe("createSingleResourceResponseSchema", () => {
    it("should create schema with data as required", () => {
      const schema = createSingleResourceResponseSchema("#/components/schemas/Photograph");
      expect(schema.required).toContain("data");
    });

    it("should reference the provided entity schema", () => {
      const ref = "#/components/schemas/Photograph";
      const schema = createSingleResourceResponseSchema(ref);
      expect((schema.properties?.data as any).$ref).toBe(ref);
    });

    it("should include links reference", () => {
      const schema = createSingleResourceResponseSchema("#/components/schemas/Photograph");
      expect((schema.properties?.links as any).$ref).toBe("#/components/schemas/JsonApiLinks");
    });

    it("should include included array for sideloaded resources", () => {
      const schema = createSingleResourceResponseSchema("#/components/schemas/Photograph");
      expect(schema.properties?.included).toBeDefined();
      const includedProperty = schema.properties?.included as any;
      expect(includedProperty.type).toBe("array");
    });
  });

  describe("createCollectionResponseSchema", () => {
    it("should create schema with data as required array", () => {
      const schema = createCollectionResponseSchema("#/components/schemas/Photograph");
      expect(schema.required).toContain("data");
      expect((schema.properties?.data as any).type).toBe("array");
    });

    it("should reference the provided entity schema in items", () => {
      const ref = "#/components/schemas/Photograph";
      const schema = createCollectionResponseSchema(ref);
      expect((schema.properties?.data as any).items.$ref).toBe(ref);
    });

    it("should include meta with pagination reference", () => {
      const schema = createCollectionResponseSchema("#/components/schemas/Photograph");
      expect((schema.properties?.meta as any).$ref).toBe("#/components/schemas/JsonApiPaginationMeta");
    });

    it("should include links reference", () => {
      const schema = createCollectionResponseSchema("#/components/schemas/Photograph");
      expect((schema.properties?.links as any).$ref).toBe("#/components/schemas/JsonApiLinks");
    });

    it("should include included array for sideloaded resources", () => {
      const schema = createCollectionResponseSchema("#/components/schemas/Photograph");
      expect(schema.properties?.included).toBeDefined();
    });
  });

  describe("getBaseJsonApiSchemas", () => {
    it("should return all base schemas", () => {
      const schemas = getBaseJsonApiSchemas();
      expect(schemas.JsonApiResourceIdentifier).toBeDefined();
      expect(schemas.JsonApiRelationship).toBeDefined();
      expect(schemas.JsonApiLinks).toBeDefined();
      expect(schemas.JsonApiPaginationMeta).toBeDefined();
    });

    it("should return exactly 4 schemas", () => {
      const schemas = getBaseJsonApiSchemas();
      expect(Object.keys(schemas).length).toBe(4);
    });
  });
});
