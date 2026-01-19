import { describe, it, expect } from "vitest";
import { cypherTypeToOpenApi, isArrayType, getBaseType } from "../cypher-to-openapi.util";
import { CypherType, CypherArrayType } from "../../../common/interfaces/entity.schema.interface";

describe("cypher-to-openapi.util", () => {
  describe("cypherTypeToOpenApi", () => {
    describe("scalar types", () => {
      it("should map string to OpenAPI string type", () => {
        const result = cypherTypeToOpenApi("string");
        expect(result).toEqual({ type: "string" });
      });

      it("should map number to OpenAPI number type", () => {
        const result = cypherTypeToOpenApi("number");
        expect(result).toEqual({ type: "number" });
      });

      it("should map boolean to OpenAPI boolean type", () => {
        const result = cypherTypeToOpenApi("boolean");
        expect(result).toEqual({ type: "boolean" });
      });

      it("should map date to OpenAPI string with date format", () => {
        const result = cypherTypeToOpenApi("date");
        expect(result).toEqual({ type: "string", format: "date" });
      });

      it("should map datetime to OpenAPI string with date-time format", () => {
        const result = cypherTypeToOpenApi("datetime");
        expect(result).toEqual({ type: "string", format: "date-time" });
      });

      it("should map json to OpenAPI object with additionalProperties", () => {
        const result = cypherTypeToOpenApi("json");
        expect(result).toEqual({ type: "object", additionalProperties: true });
      });
    });

    describe("array types", () => {
      it("should map string[] to OpenAPI array of strings", () => {
        const result = cypherTypeToOpenApi("string[]");
        expect(result).toEqual({
          type: "array",
          items: { type: "string" },
        });
      });

      it("should map number[] to OpenAPI array of numbers", () => {
        const result = cypherTypeToOpenApi("number[]");
        expect(result).toEqual({
          type: "array",
          items: { type: "number" },
        });
      });

      it("should map boolean[] to OpenAPI array of booleans", () => {
        const result = cypherTypeToOpenApi("boolean[]");
        expect(result).toEqual({
          type: "array",
          items: { type: "boolean" },
        });
      });

      it("should map date[] to OpenAPI array of date strings", () => {
        const result = cypherTypeToOpenApi("date[]");
        expect(result).toEqual({
          type: "array",
          items: { type: "string", format: "date" },
        });
      });

      it("should map datetime[] to OpenAPI array of datetime strings", () => {
        const result = cypherTypeToOpenApi("datetime[]");
        expect(result).toEqual({
          type: "array",
          items: { type: "string", format: "date-time" },
        });
      });

      it("should map json[] to OpenAPI array of objects", () => {
        const result = cypherTypeToOpenApi("json[]");
        expect(result).toEqual({
          type: "array",
          items: { type: "object", additionalProperties: true },
        });
      });
    });

    describe("all CypherType values", () => {
      const allCypherTypes: CypherType[] = [
        "string",
        "number",
        "boolean",
        "date",
        "datetime",
        "json",
        "string[]",
        "number[]",
        "boolean[]",
        "date[]",
        "datetime[]",
        "json[]",
      ];

      it.each(allCypherTypes)("should handle %s type without throwing", (cypherType) => {
        expect(() => cypherTypeToOpenApi(cypherType)).not.toThrow();
        const result = cypherTypeToOpenApi(cypherType);
        expect(result).toBeDefined();
        expect(result.type).toBeDefined();
      });
    });
  });

  describe("isArrayType", () => {
    it("should return true for array types", () => {
      expect(isArrayType("string[]")).toBe(true);
      expect(isArrayType("number[]")).toBe(true);
      expect(isArrayType("boolean[]")).toBe(true);
      expect(isArrayType("date[]")).toBe(true);
      expect(isArrayType("datetime[]")).toBe(true);
      expect(isArrayType("json[]")).toBe(true);
    });

    it("should return false for scalar types", () => {
      expect(isArrayType("string")).toBe(false);
      expect(isArrayType("number")).toBe(false);
      expect(isArrayType("boolean")).toBe(false);
      expect(isArrayType("date")).toBe(false);
      expect(isArrayType("datetime")).toBe(false);
      expect(isArrayType("json")).toBe(false);
    });
  });

  describe("getBaseType", () => {
    it("should extract base type from array types", () => {
      expect(getBaseType("string[]")).toBe("string");
      expect(getBaseType("number[]")).toBe("number");
      expect(getBaseType("boolean[]")).toBe("boolean");
      expect(getBaseType("date[]")).toBe("date");
      expect(getBaseType("datetime[]")).toBe("datetime");
      expect(getBaseType("json[]")).toBe("json");
    });
  });
});
