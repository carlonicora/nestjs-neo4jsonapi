import { describe, expect, it } from "vitest";
import { BLOG_SUMMARY_SYSTEM_PROMPT } from "../blog-summary.prompt";

describe("BLOG_SUMMARY_SYSTEM_PROMPT", () => {
  it("contains no backticks (template-literal safety)", () => {
    expect(BLOG_SUMMARY_SYSTEM_PROMPT.includes("`")).toBe(false);
  });

  it("contains no dynamic placeholders (data travels via inputParams)", () => {
    expect(BLOG_SUMMARY_SYSTEM_PROMPT).not.toMatch(/\$\{/);
  });
});
