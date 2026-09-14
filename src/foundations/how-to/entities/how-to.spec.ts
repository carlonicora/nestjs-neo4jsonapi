import { describe, expect, it } from "vitest";
import { HowToDescriptor } from "./how-to";

describe("HowToDescriptor", () => {
  it("documents the entity for the graph catalogue", () => {
    expect(typeof HowToDescriptor.description).toBe("string");
    expect(HowToDescriptor.description?.trim().length).toBeGreaterThan(0);
  });

  it("documents every field", () => {
    const fields = Object.entries(HowToDescriptor.fields);
    expect(fields.length).toBeGreaterThan(0);

    const undocumented = fields
      .filter(([, definition]) => !definition.description || definition.description.trim().length === 0)
      .map(([name]) => name);

    expect(undocumented).toEqual([]);
  });

  it("exposes the chat text search fields the index manager needs", () => {
    expect(HowToDescriptor.chat?.textSearchFields).toEqual(["name", "description"]);
  });

  it("summarises a guide by name and falls back to its id", () => {
    const summary = HowToDescriptor.chat?.summary;
    expect(summary).toBeDefined();
    expect(summary?.({ id: "how-to-id", name: "How to create a proceeding" })).toBe("How to create a proceeding");
    expect(summary?.({ id: "how-to-id" })).toBe("how-to-id");
  });
});
