import { describe, it, expect } from "vitest";
import { generateExampleValue, generateExampleAttributes } from "../example-generator.util";
import { FieldDef } from "../../../common/interfaces/entity.schema.interface";

describe("example-generator.util", () => {
  describe("generateExampleValue", () => {
    describe("default values", () => {
      it("should use field default when available", () => {
        const fieldDef: FieldDef = { type: "string", default: "custom default" };
        expect(generateExampleValue("anyField", fieldDef)).toBe("custom default");
      });

      it("should use numeric default when available", () => {
        const fieldDef: FieldDef = { type: "number", default: 100 };
        expect(generateExampleValue("count", fieldDef)).toBe(100);
      });

      it("should use boolean default when available", () => {
        const fieldDef: FieldDef = { type: "boolean", default: false };
        expect(generateExampleValue("enabled", fieldDef)).toBe(false);
      });
    });

    describe("name-based patterns", () => {
      it("should generate ID pattern for id fields", () => {
        const fieldDef: FieldDef = { type: "string" };
        expect(generateExampleValue("id", fieldDef)).toBe("abc123-def456-ghi789");
        expect(generateExampleValue("userId", fieldDef)).toBe("abc123-def456-ghi789");
        expect(generateExampleValue("accountId", fieldDef)).toBe("abc123-def456-ghi789");
      });

      it("should generate URL pattern for URL fields", () => {
        const fieldDef: FieldDef = { type: "string" };
        expect(generateExampleValue("url", fieldDef)).toBe("https://example.com/resource/123");
        expect(generateExampleValue("imageUrl", fieldDef)).toBe("https://example.com/resource/123");
        expect(generateExampleValue("profileUri", fieldDef)).toBe("https://example.com/resource/123");
        expect(generateExampleValue("link", fieldDef)).toBe("https://example.com/resource/123");
      });

      it("should generate email pattern for email fields", () => {
        const fieldDef: FieldDef = { type: "string" };
        expect(generateExampleValue("email", fieldDef)).toBe("user@example.com");
        expect(generateExampleValue("userEmail", fieldDef)).toBe("user@example.com");
      });

      it("should generate name pattern for name fields", () => {
        const fieldDef: FieldDef = { type: "string" };
        expect(generateExampleValue("name", fieldDef)).toBe("Example Name");
        expect(generateExampleValue("firstName", fieldDef)).toBe("Example Name");
        expect(generateExampleValue("displayName", fieldDef)).toBe("Example Name");
      });

      it("should generate title pattern for title fields", () => {
        const fieldDef: FieldDef = { type: "string" };
        expect(generateExampleValue("title", fieldDef)).toBe("Example Title");
        expect(generateExampleValue("pageTitle", fieldDef)).toBe("Example Title");
      });

      it("should generate description pattern for description fields", () => {
        const fieldDef: FieldDef = { type: "string" };
        expect(generateExampleValue("description", fieldDef)).toBe("This is an example description or content text.");
        expect(generateExampleValue("content", fieldDef)).toBe("This is an example description or content text.");
        expect(generateExampleValue("bodyText", fieldDef)).toBe("This is an example description or content text.");
      });

      it("should generate phone pattern for phone fields", () => {
        const fieldDef: FieldDef = { type: "string" };
        expect(generateExampleValue("phone", fieldDef)).toBe("+1-555-123-4567");
        expect(generateExampleValue("telephone", fieldDef)).toBe("+1-555-123-4567");
      });

      it("should generate address pattern for address fields", () => {
        const fieldDef: FieldDef = { type: "string" };
        expect(generateExampleValue("address", fieldDef)).toBe("123 Example Street, City, Country");
      });

      it("should generate count pattern for count fields", () => {
        const fieldDef: FieldDef = { type: "number" };
        expect(generateExampleValue("count", fieldDef)).toBe(10);
        expect(generateExampleValue("totalItems", fieldDef)).toBe(10);
        expect(generateExampleValue("quantity", fieldDef)).toBe(10);
      });

      it("should generate price pattern for price fields", () => {
        const fieldDef: FieldDef = { type: "number" };
        expect(generateExampleValue("price", fieldDef)).toBe(99.99);
        expect(generateExampleValue("amount", fieldDef)).toBe(99.99);
        expect(generateExampleValue("cost", fieldDef)).toBe(99.99);
      });

      it("should generate percentage pattern for percentage fields", () => {
        const fieldDef: FieldDef = { type: "number" };
        expect(generateExampleValue("percentage", fieldDef)).toBe(75.5);
        expect(generateExampleValue("discountRate", fieldDef)).toBe(75.5);
      });

      it("should generate true for enabled/active fields", () => {
        const fieldDef: FieldDef = { type: "boolean" };
        expect(generateExampleValue("enabled", fieldDef)).toBe(true);
        expect(generateExampleValue("isActive", fieldDef)).toBe(true);
        expect(generateExampleValue("visible", fieldDef)).toBe(true);
      });

      it("should generate false for disabled/hidden fields", () => {
        const fieldDef: FieldDef = { type: "boolean" };
        expect(generateExampleValue("disabled", fieldDef)).toBe(false);
        expect(generateExampleValue("hidden", fieldDef)).toBe(false);
        expect(generateExampleValue("deleted", fieldDef)).toBe(false);
      });
    });

    describe("type-based fallbacks", () => {
      it("should generate fallback for string type", () => {
        const fieldDef: FieldDef = { type: "string" };
        expect(generateExampleValue("unknownField", fieldDef)).toBe("example value");
      });

      it("should generate fallback for number type", () => {
        const fieldDef: FieldDef = { type: "number" };
        expect(generateExampleValue("unknownField", fieldDef)).toBe(42);
      });

      it("should generate fallback for boolean type", () => {
        const fieldDef: FieldDef = { type: "boolean" };
        expect(generateExampleValue("unknownField", fieldDef)).toBe(true);
      });

      it("should generate fallback for date type", () => {
        const fieldDef: FieldDef = { type: "date" };
        expect(generateExampleValue("unknownField", fieldDef)).toBe("2024-01-15");
      });

      it("should generate fallback for datetime type", () => {
        const fieldDef: FieldDef = { type: "datetime" };
        expect(generateExampleValue("unknownField", fieldDef)).toBe("2024-01-15T10:30:00Z");
      });

      it("should generate fallback for json type", () => {
        const fieldDef: FieldDef = { type: "json" };
        expect(generateExampleValue("unknownField", fieldDef)).toEqual({ key: "value" });
      });
    });

    describe("array types", () => {
      it("should wrap example in array for string[]", () => {
        const fieldDef: FieldDef = { type: "string[]" };
        expect(generateExampleValue("tags", fieldDef)).toEqual(["example value"]);
      });

      it("should wrap example in array for number[]", () => {
        const fieldDef: FieldDef = { type: "number[]" };
        expect(generateExampleValue("scores", fieldDef)).toEqual([42]);
      });

      it("should use pattern-based example for array type", () => {
        const fieldDef: FieldDef = { type: "string[]" };
        expect(generateExampleValue("emails", fieldDef)).toEqual(["user@example.com"]);
      });
    });
  });

  describe("generateExampleAttributes", () => {
    it("should generate examples for all fields", () => {
      const fields: Record<string, FieldDef> = {
        name: { type: "string" },
        email: { type: "string" },
        age: { type: "number" },
        isActive: { type: "boolean" },
      };

      const result = generateExampleAttributes(fields);

      expect(result).toEqual({
        name: "Example Name",
        email: "user@example.com",
        age: 42,
        isActive: true,
      });
    });

    it("should handle empty fields object", () => {
      const result = generateExampleAttributes({});
      expect(result).toEqual({});
    });

    it("should use defaults when provided", () => {
      const fields: Record<string, FieldDef> = {
        status: { type: "string", default: "pending" },
        retries: { type: "number", default: 3 },
      };

      const result = generateExampleAttributes(fields);

      expect(result).toEqual({
        status: "pending",
        retries: 3,
      });
    });
  });
});
