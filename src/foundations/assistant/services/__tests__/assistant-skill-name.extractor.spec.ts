import { describe, expect, it } from "vitest";
import { extractNamedSkills } from "../assistant-skill-name.extractor";

describe("extractNamedSkills", () => {
  const names = ["email", "humanizer", "quote-2"];

  it("finds a skill named with a slash after whitespace", () => {
    expect(extractNamedSkills("send an /email to Marta", names)).toEqual(["email"]);
  });

  it("keeps the order of first appearance", () => {
    expect(extractNamedSkills("/email first, then /humanizer.", names)).toEqual(["email", "humanizer"]);
  });

  it("finds a skill at the start of a line", () => {
    expect(extractNamedSkills("line one\n/quote-2", names)).toEqual(["quote-2"]);
  });

  it("drops duplicates", () => {
    expect(extractNamedSkills("/email /email", names)).toEqual(["email"]);
  });

  it("accepts trailing punctuation", () => {
    expect(extractNamedSkills("use /email, /humanizer; /quote-2!", names)).toEqual(["email", "humanizer", "quote-2"]);
  });

  it("ignores a slash inside ordinary text", () => {
    expect(extractNamedSkills("and/or", names)).toEqual([]);
    expect(extractNamedSkills("on 12/03/2026 at src/email/page.tsx", names)).toEqual([]);
    expect(extractNamedSkills("see https://x.test/email", names)).toEqual([]);
  });

  it("ignores a longer word, an unknown name and a different case", () => {
    expect(extractNamedSkills("/emails please", names)).toEqual([]);
    expect(extractNamedSkills("/unknown thing", names)).toEqual([]);
    expect(extractNamedSkills("/Email", names)).toEqual([]);
  });

  it("returns nothing for empty text", () => {
    expect(extractNamedSkills("", names)).toEqual([]);
  });
});
