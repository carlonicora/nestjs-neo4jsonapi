import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("turns a title into lowercase kebab-case", () => {
    expect(slugify("Prepara situazioni, non trame!")).toBe("prepara-situazioni-non-trame");
  });

  it("strips diacritics", () => {
    expect(slugify("Città è già")).toBe("citta-e-gia");
  });

  it("falls back to post when nothing usable is left", () => {
    expect(slugify("!!!")).toBe("post");
    expect(slugify("")).toBe("post");
  });

  it("caps the slug at 80 characters", () => {
    expect(slugify("a".repeat(120)).length).toBe(80);
  });

  it("never ends with a dash after truncation", () => {
    const slug = slugify(`${"a".repeat(79)} b`);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("returns the base when it is free", () => {
    expect(uniqueSlug("prep", [])).toBe("prep");
  });

  it("appends the first free numeric suffix", () => {
    expect(uniqueSlug("prep", ["prep"])).toBe("prep-2");
    expect(uniqueSlug("prep", ["prep", "prep-2"])).toBe("prep-3");
  });
});
