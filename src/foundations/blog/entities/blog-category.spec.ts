import { describe, expect, it } from "vitest";
import { BlogCategoryDescriptor } from "./blog-category";

describe("BlogCategoryDescriptor", () => {
  it("documents the entity and every field", () => {
    expect(BlogCategoryDescriptor.description?.trim().length).toBeGreaterThan(0);
    expect(Object.entries(BlogCategoryDescriptor.fields).filter(([, d]) => !d.description?.trim())).toEqual([]);
  });

  it("is global", () => {
    expect(BlogCategoryDescriptor.isCompanyScoped).toBe(false);
    expect(BlogCategoryDescriptor.tenancy).toBe("global");
  });

  it("keeps every string field out of the full-text index", () => {
    expect(BlogCategoryDescriptor.indexes).toEqual([]);
  });

  it("reads the resolved-language fields from their record aliases", () => {
    const record = {
      has: (alias: string) => alias === "resolvedName",
      get: (alias: string) => (alias === "resolvedName" ? "Design" : undefined),
    };
    const params = { data: {}, record, entityFactory: undefined };

    expect(BlogCategoryDescriptor.computed?.name?.compute(params)).toBe("Design");
    expect(BlogCategoryDescriptor.computed?.slug?.compute(params)).toBeUndefined();
  });

  it("owns its translations through HAS_TRANSLATION", () => {
    expect(BlogCategoryDescriptor.relationships.translations).toMatchObject({
      direction: "out",
      relationship: "HAS_TRANSLATION",
      cardinality: "many",
    });
  });
});
