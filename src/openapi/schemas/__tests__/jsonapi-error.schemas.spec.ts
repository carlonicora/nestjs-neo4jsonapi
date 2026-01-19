import { describe, it, expect } from "vitest";
import {
  JsonApiErrorSourceSchema,
  JsonApiErrorSchema,
  JsonApiErrorResponseSchema,
  getErrorResponseSchemas,
} from "../jsonapi-error.schemas";

describe("jsonapi-error.schemas", () => {
  describe("JsonApiErrorSourceSchema", () => {
    it("should have pointer property", () => {
      expect(JsonApiErrorSourceSchema.properties?.pointer).toBeDefined();
      const pointerProperty = JsonApiErrorSourceSchema.properties?.pointer as any;
      expect(pointerProperty.type).toBe("string");
    });

    it("should have parameter property", () => {
      expect(JsonApiErrorSourceSchema.properties?.parameter).toBeDefined();
      const parameterProperty = JsonApiErrorSourceSchema.properties?.parameter as any;
      expect(parameterProperty.type).toBe("string");
    });

    it("should have header property", () => {
      expect(JsonApiErrorSourceSchema.properties?.header).toBeDefined();
      const headerProperty = JsonApiErrorSourceSchema.properties?.header as any;
      expect(headerProperty.type).toBe("string");
    });
  });

  describe("JsonApiErrorSchema", () => {
    it("should have status and title as required", () => {
      expect(JsonApiErrorSchema.required).toContain("status");
      expect(JsonApiErrorSchema.required).toContain("title");
    });

    it("should have all error properties", () => {
      expect(JsonApiErrorSchema.properties?.id).toBeDefined();
      expect(JsonApiErrorSchema.properties?.status).toBeDefined();
      expect(JsonApiErrorSchema.properties?.code).toBeDefined();
      expect(JsonApiErrorSchema.properties?.title).toBeDefined();
      expect(JsonApiErrorSchema.properties?.detail).toBeDefined();
      expect(JsonApiErrorSchema.properties?.source).toBeDefined();
      expect(JsonApiErrorSchema.properties?.meta).toBeDefined();
    });

    it("should reference JsonApiErrorSource for source property", () => {
      const sourceProperty = JsonApiErrorSchema.properties?.source as any;
      expect(sourceProperty.$ref).toBe("#/components/schemas/JsonApiErrorSource");
    });
  });

  describe("JsonApiErrorResponseSchema", () => {
    it("should have errors as required", () => {
      expect(JsonApiErrorResponseSchema.required).toContain("errors");
    });

    it("should have errors as array with minItems 1", () => {
      const errorsProperty = JsonApiErrorResponseSchema.properties?.errors as any;
      expect(errorsProperty.type).toBe("array");
      expect(errorsProperty.minItems).toBe(1);
    });

    it("should reference JsonApiError for array items", () => {
      const errorsProperty = JsonApiErrorResponseSchema.properties?.errors as any;
      expect(errorsProperty.items.$ref).toBe("#/components/schemas/JsonApiError");
    });
  });

  describe("getErrorResponseSchemas", () => {
    it("should return all error schemas", () => {
      const schemas = getErrorResponseSchemas();
      expect(schemas.JsonApiErrorSource).toBeDefined();
      expect(schemas.JsonApiError).toBeDefined();
      expect(schemas.JsonApiErrorResponse).toBeDefined();
    });

    it("should return 400 error response schema with example", () => {
      const schemas = getErrorResponseSchemas();
      expect(schemas.JsonApi400ErrorResponse).toBeDefined();
      expect(schemas.JsonApi400ErrorResponse.allOf).toBeDefined();

      const exampleSchema = schemas.JsonApi400ErrorResponse.allOf?.find((s: any) => s.example) as any;
      expect(exampleSchema.example.errors[0].status).toBe("400");
    });

    it("should return 401 error response schema with example", () => {
      const schemas = getErrorResponseSchemas();
      expect(schemas.JsonApi401ErrorResponse).toBeDefined();

      const exampleSchema = schemas.JsonApi401ErrorResponse.allOf?.find((s: any) => s.example) as any;
      expect(exampleSchema.example.errors[0].status).toBe("401");
    });

    it("should return 403 error response schema with example", () => {
      const schemas = getErrorResponseSchemas();
      expect(schemas.JsonApi403ErrorResponse).toBeDefined();

      const exampleSchema = schemas.JsonApi403ErrorResponse.allOf?.find((s: any) => s.example) as any;
      expect(exampleSchema.example.errors[0].status).toBe("403");
    });

    it("should return 404 error response schema with example", () => {
      const schemas = getErrorResponseSchemas();
      expect(schemas.JsonApi404ErrorResponse).toBeDefined();

      const exampleSchema = schemas.JsonApi404ErrorResponse.allOf?.find((s: any) => s.example) as any;
      expect(exampleSchema.example.errors[0].status).toBe("404");
    });

    it("should return 422 error response schema with source pointer", () => {
      const schemas = getErrorResponseSchemas();
      expect(schemas.JsonApi422ErrorResponse).toBeDefined();

      const exampleSchema = schemas.JsonApi422ErrorResponse.allOf?.find((s: any) => s.example) as any;
      expect(exampleSchema.example.errors[0].status).toBe("422");
      expect(exampleSchema.example.errors[0].source.pointer).toBeDefined();
    });

    it("should return 500 error response schema with example", () => {
      const schemas = getErrorResponseSchemas();
      expect(schemas.JsonApi500ErrorResponse).toBeDefined();

      const exampleSchema = schemas.JsonApi500ErrorResponse.allOf?.find((s: any) => s.example) as any;
      expect(exampleSchema.example.errors[0].status).toBe("500");
    });

    it("should return exactly 9 schemas", () => {
      const schemas = getErrorResponseSchemas();
      // Base + 6 HTTP status code specific schemas
      expect(Object.keys(schemas).length).toBe(9);
    });
  });
});
