import { describe, expect, it } from "vitest";
import { buildFulltextTerm, escapeLuceneTerm } from "../build-fulltext-term";

describe("buildFulltextTerm", () => {
  it("wraps a single token in contains-wildcards", () => {
    expect(buildFulltextTerm("rossi")).toBe("*rossi*");
    expect(buildFulltextTerm("1195")).toBe("*1195*");
  });

  it("lowercases, which also neutralises Lucene's uppercase-only operators", () => {
    // AND/OR/NOT are case-sensitive operators; lowercased they are plain tokens.
    expect(buildFulltextTerm("Rossi")).toBe("*rossi*");
    expect(buildFulltextTerm("Rossi AND Bianchi")).toBe("*rossi* AND *and* AND *bianchi*");
  });

  it("splits on the characters the index analyser splits on, so the query can actually match", () => {
    // The stored tokens for "l. 1195/1940" are `l`, `1195`, `1940` — a single
    // `*1195/1940*` would parse (once escaped) and then match nothing.
    expect(buildFulltextTerm("123/2026")).toBe("*123* AND *2026*");
    expect(buildFulltextTerm("l. 1195")).toBe("*l* AND *1195*");
    expect(buildFulltextTerm("E2E Causa Civile 123/2026")).toBe("*e2e* AND *causa* AND *civile* AND *123* AND *2026*");
  });

  it("never lets Lucene syntax reach the parser (the 500 this fixes)", () => {
    for (const c of ["+", "-", "!", "(", ")", "{", "}", "[", "]", "^", '"', "~", "*", "?", ":", "\\", "/", "&", "|"]) {
      const out = buildFulltextTerm(`a${c}b`);
      // Fully specifies the result: the character is gone and the two
      // surrounding tokens are AND-joined. (`*` is excluded from the
      // "not present" check below only because the wildcards we ADD are `*`.)
      expect(out).toBe("*a* AND *b*");
      if (c !== "*") expect(out).not.toContain(c);
    }
  });

  it("survives the real-world terms that used to 500", () => {
    expect(buildFulltextTerm("R.G. 45-2026")).toBe("*r* AND *g* AND *45* AND *2026*");
    expect(buildFulltextTerm("10:00")).toBe("*10* AND *00*");
    expect(buildFulltextTerm("art. 2043 c.c. (danno)")).toBe("*art* AND *2043* AND *c* AND *c* AND *danno*");
  });

  it("keeps accented Italian letters intact rather than splitting on them", () => {
    expect(buildFulltextTerm("città")).toBe("*città*");
    expect(buildFulltextTerm("però perché")).toBe("*però* AND *perché*");
  });

  it("returns undefined only when NO term was supplied", () => {
    expect(buildFulltextTerm(undefined)).toBeUndefined();
    expect(buildFulltextTerm(null)).toBeUndefined();
  });

  it("treats an empty string as a supplied term and returns a bindable value", () => {
    // search.repository.find takes a required `term: string` and references
    // $term unconditionally — undefined would leave the parameter unbound.
    expect(buildFulltextTerm("")).toBe("*");
  });

  it("returns match-all, never undefined, for a non-empty term that tokenises to nothing", () => {
    // Call sites guard on `if (params.term)` and then reference $term in the
    // Cypher — undefined here would leave the parameter unbound.
    expect(buildFulltextTerm("///")).toBe("*");
    expect(buildFulltextTerm("   ")).toBe("*");
    expect(buildFulltextTerm("-")).toBe("*");
  });
});

describe("escapeLuceneTerm", () => {
  it("escapes every character Lucene's classic parser treats as syntax", () => {
    for (const c of ["+", "-", "!", "(", ")", "{", "}", "[", "]", "^", '"', "~", "*", "?", ":", "\\", "/", "&", "|"]) {
      expect(escapeLuceneTerm(`a${c}b`)).toBe(`a\\${c}b`);
    }
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLuceneTerm("mario rossi")).toBe("mario rossi");
    expect(escapeLuceneTerm("città però")).toBe("città però");
  });
});
