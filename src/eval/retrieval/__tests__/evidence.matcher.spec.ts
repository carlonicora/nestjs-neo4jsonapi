import { describe, it, expect } from "vitest";
import { EvidenceMatcher } from "../evidence.matcher";

describe("EvidenceMatcher", () => {
  const matcher = new EvidenceMatcher();

  it("matches a snippet regardless of surrounding whitespace and case", () => {
    expect(
      matcher.matches({
        snippet: "quindici (15) giorni",
        haystack: "Decorso il termine di   QUINDICI (15)\n giorni, il locatore procede.",
      }),
    ).toBe(true);
  });

  it("does not match a snippet that is absent", () => {
    expect(matcher.matches({ snippet: "Legge 392/1978", haystack: "Codice Civile art. 1455" })).toBe(false);
  });

  it("scores a snippet list into found and missing", () => {
    const result = matcher.score({
      snippets: ["quindici (15) giorni", "Legge 392/1978"],
      haystack: "Decorso il termine di quindici (15) giorni...",
    });
    expect(result.found).toBe(1);
    expect(result.missing).toEqual(["Legge 392/1978"]);
  });
});
