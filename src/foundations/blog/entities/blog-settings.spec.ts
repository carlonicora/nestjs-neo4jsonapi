import { describe, expect, it } from "vitest";
import { BlogSettingsDescriptor } from "./blog-settings";

describe("BlogSettingsDescriptor", () => {
  it("documents the entity and every field", () => {
    expect(BlogSettingsDescriptor.description?.trim().length).toBeGreaterThan(0);
    expect(Object.entries(BlogSettingsDescriptor.fields).filter(([, d]) => !d.description?.trim())).toEqual([]);
  });

  it("is global", () => {
    expect(BlogSettingsDescriptor.isCompanyScoped).toBe(false);
    expect(BlogSettingsDescriptor.tenancy).toBe("global");
  });

  it("keeps listLayout out of the full-text index", () => {
    expect(BlogSettingsDescriptor.indexes).toEqual([]);
  });
});
