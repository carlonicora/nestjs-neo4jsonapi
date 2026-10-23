import { describe, expect, it } from "vitest";
import { BlogCategoryTranslationDescriptor } from "./blog-category-translation";

describe("BlogCategoryTranslationDescriptor", () => {
  it("documents the entity and every field", () => {
    expect(BlogCategoryTranslationDescriptor.description?.trim().length).toBeGreaterThan(0);
    expect(Object.entries(BlogCategoryTranslationDescriptor.fields).filter(([, d]) => !d.description?.trim())).toEqual(
      [],
    );
  });

  it("is global", () => {
    expect(BlogCategoryTranslationDescriptor.isCompanyScoped).toBe(false);
    expect(BlogCategoryTranslationDescriptor.tenancy).toBe("global");
  });

  it("stores translatedAt as datetime", () => {
    expect(BlogCategoryTranslationDescriptor.fields.translatedAt.type).toBe("datetime");
  });

  it("indexes name and description for search", () => {
    const index = BlogCategoryTranslationDescriptor.indexes?.find((i) => i.type === "FULLTEXT");
    expect([...(index?.properties ?? [])].sort()).toEqual(["description", "name"]);
  });

  it("belongs to its category through HAS_TRANSLATION", () => {
    expect(BlogCategoryTranslationDescriptor.relationships.category).toMatchObject({
      direction: "in",
      relationship: "HAS_TRANSLATION",
      cardinality: "one",
    });
  });
});
