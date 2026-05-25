import { describe, it, expect } from "vitest";
import { helpFrontmatterSchema } from "../frontmatter.schema";

describe("helpFrontmatterSchema", () => {
  it("accepts a minimal valid record", () => {
    const parsed = helpFrontmatterSchema.parse({
      title: "Adding an NPC",
      mode: "how-to",
      order: 1,
      summary: "Create a non-player character.",
    });
    expect(parsed.tags).toEqual([]);
    expect(parsed.contextual_keys).toEqual([]);
    expect(parsed.ai_indexed).toBe(true);
    expect(parsed.draft).toBe(false);
    expect(parsed.related).toEqual([]);
  });

  it("rejects an unknown mode", () => {
    expect(() => helpFrontmatterSchema.parse({ title: "x", mode: "rant", order: 1, summary: "y" })).toThrow();
  });

  it("rejects malformed contextual_keys", () => {
    expect(() =>
      helpFrontmatterSchema.parse({
        title: "x",
        mode: "how-to",
        order: 1,
        summary: "y",
        contextual_keys: ["NPC.Editor"],
      }),
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => helpFrontmatterSchema.parse({ title: "x", mode: "how-to" })).toThrow();
  });
});
