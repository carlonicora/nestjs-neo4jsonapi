import { describe, expect, it } from "vitest";
import { BlogPostTranslationDescriptor } from "./blog-post-translation";

describe("BlogPostTranslationDescriptor", () => {
  it("documents the entity and every field", () => {
    expect(BlogPostTranslationDescriptor.description?.trim().length).toBeGreaterThan(0);
    expect(Object.entries(BlogPostTranslationDescriptor.fields).filter(([, d]) => !d.description?.trim())).toEqual([]);
  });

  it("is unscoped and kept out of the assistant catalog", () => {
    expect(BlogPostTranslationDescriptor.isCompanyScoped).toBe(false);
    expect(BlogPostTranslationDescriptor.tenancy).toBe("internal");
  });

  it("stores translatedAt as datetime", () => {
    expect(BlogPostTranslationDescriptor.fields.translatedAt.type).toBe("datetime");
  });

  it("indexes title, summary and bodyText for search", () => {
    const index = BlogPostTranslationDescriptor.indexes?.find((i) => i.type === "FULLTEXT");
    expect(index?.name).toBe("blogPostTranslation_search_index");
    expect([...(index?.properties ?? [])].sort()).toEqual(["bodyText", "summary", "title"]);
  });

  it("belongs to its post through HAS_TRANSLATION", () => {
    expect(BlogPostTranslationDescriptor.relationships.post).toMatchObject({
      direction: "in",
      relationship: "HAS_TRANSLATION",
      cardinality: "one",
    });
  });
});
