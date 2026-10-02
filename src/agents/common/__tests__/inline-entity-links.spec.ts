import { describe, expect, it } from "vitest";
import { RESPONDER_INLINE_LINKS_INSTRUCTION, resolveRefLinks, sanitiseMentionLinks } from "../inline-entity-links";

describe("resolveRefLinks", () => {
  const byRef = new Map([["ref:0", { type: "accounts", id: "a1" }]]);

  it("turns a known ref link into a mention link", () => {
    expect(resolveRefLinks("Il cliente [Rossi](ref:0).", byRef)).toBe("Il cliente [Rossi](mention://accounts/a1).");
  });

  it("turns an unknown ref link into its plain text", () => {
    expect(resolveRefLinks("Il cliente [Rossi](ref:9).", byRef)).toBe("Il cliente Rossi.");
  });

  it("leaves a normal link untouched", () => {
    const text = "Vedi [x](https://example.com/page) e [Rossi](ref:0)";
    expect(resolveRefLinks(text, byRef)).toBe("Vedi [x](https://example.com/page) e [Rossi](mention://accounts/a1)");
  });
});

describe("sanitiseMentionLinks", () => {
  const isAllowed = (type: string, id: string) => type === "accounts" && id === "a1";

  it("keeps an allowed mention link", () => {
    expect(sanitiseMentionLinks("[Rossi](mention://accounts/a1)", isAllowed)).toBe("[Rossi](mention://accounts/a1)");
  });

  it("strips a disallowed mention link to its text", () => {
    expect(sanitiseMentionLinks("Vedi [Bianchi](mention://accounts/a2).", isAllowed)).toBe("Vedi Bianchi.");
  });

  it("leaves non-mention links alone", () => {
    const text = "[x](https://example.com) [y](ref:0)";
    expect(sanitiseMentionLinks(text, isAllowed)).toBe(text);
  });
});

describe("RESPONDER_INLINE_LINKS_INSTRUCTION", () => {
  it("requires the link text to be the linked entity's own name", () => {
    expect(RESPONDER_INLINE_LINKS_INSTRUCTION).toMatch(/link text must be the listed entity's own name or title/);
    expect(RESPONDER_INLINE_LINKS_INSTRUCTION).toMatch(
      /no handle of its own in the list, write its name as plain text/,
    );
  });

  it("contains no backticks (template-literal safety)", () => {
    expect(RESPONDER_INLINE_LINKS_INSTRUCTION.includes("`")).toBe(false);
  });

  it("contains no dynamic placeholders (data travels via inputParams)", () => {
    expect(RESPONDER_INLINE_LINKS_INSTRUCTION).not.toMatch(/\$\{/);
  });
});
