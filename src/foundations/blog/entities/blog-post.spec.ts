import { describe, expect, it } from "vitest";
import { BlogPostDescriptor } from "./blog-post";

describe("BlogPostDescriptor", () => {
  it("documents the entity and every field", () => {
    expect(BlogPostDescriptor.description?.trim().length).toBeGreaterThan(0);
    expect(Object.entries(BlogPostDescriptor.fields).filter(([, d]) => !d.description?.trim())).toEqual([]);
  });

  it("is unscoped and kept out of the assistant catalog", () => {
    expect(BlogPostDescriptor.isCompanyScoped).toBe(false);
    expect(BlogPostDescriptor.tenancy).toBe("internal");
  });

  it("stores publishedAt as datetime", () => {
    expect(BlogPostDescriptor.fields.publishedAt.type).toBe("datetime");
  });

  it("keeps every string field out of the full-text index", () => {
    expect(BlogPostDescriptor.indexes).toEqual([]);
  });

  it("reads the resolved-language fields from their record aliases", () => {
    const record = {
      has: (alias: string) => ["resolvedTitle", "resolvedReadingMinutes", "categoryIds"].includes(alias),
      get: (alias: string) =>
        ({ resolvedTitle: "Hello", resolvedReadingMinutes: { toNumber: () => 4 }, categoryIds: ["c1", null] })[alias],
    };
    const params = { data: {}, record, entityFactory: undefined };

    expect(BlogPostDescriptor.computed?.title?.compute(params)).toBe("Hello");
    expect(BlogPostDescriptor.computed?.readingMinutes?.compute(params)).toBe(4);
    expect(BlogPostDescriptor.computed?.categoryIds?.compute(params)).toEqual(["c1"]);
    expect(BlogPostDescriptor.computed?.slug?.compute(params)).toBeUndefined();
  });

  it("relates author in, categories and translations out", () => {
    expect(BlogPostDescriptor.relationships.author).toMatchObject({
      direction: "in",
      relationship: "AUTHORED",
      cardinality: "one",
    });
    expect(BlogPostDescriptor.relationships.categories).toMatchObject({
      direction: "out",
      relationship: "IN_BLOG_CATEGORY",
      cardinality: "many",
      dtoKey: "categories",
    });
    expect(BlogPostDescriptor.relationships.translations).toMatchObject({
      direction: "out",
      relationship: "HAS_TRANSLATION",
      cardinality: "many",
    });
  });
});
