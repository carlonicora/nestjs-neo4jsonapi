import { describe, expect, it } from "vitest";
import { normaliseRequestLanguage } from "../request-language";

describe("normaliseRequestLanguage", () => {
  it.each([
    ["it-IT", "it"],
    ["IT", "it"],
    [" en ", "en"],
    ["pt_BR", "pt"],
  ])("normalises %j to %j", (raw, expected) => {
    expect(normaliseRequestLanguage(raw)).toBe(expected);
  });

  it.each([[undefined], [null], [""]])("returns en for %j", (raw) => {
    expect(normaliseRequestLanguage(raw)).toBe("en");
  });

  it("takes the first item of an array header", () => {
    expect(normaliseRequestLanguage(["it", "en"])).toBe("it");
  });
});
