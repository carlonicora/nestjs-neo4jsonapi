import { describe, expect, it } from "vitest";
import { hasSignupSource, parseSignupSourceParam, sanitiseSignupSource } from "../signup-source";

describe("signup-source", () => {
  describe("sanitiseSignupSource", () => {
    it("keeps only the six keys and trims values", () => {
      expect(sanitiseSignupSource({ sourceRef: " reddit ", other: "x" })).toEqual({ sourceRef: "reddit" });
    });

    it("truncates values to 200 characters", () => {
      expect(sanitiseSignupSource({ sourceRef: "a".repeat(250) })?.sourceRef?.length).toBe(200);
    });

    it("returns undefined when no non-empty string is left", () => {
      expect(sanitiseSignupSource({ sourceRef: "", sourceUtmSource: 5 })).toBeUndefined();
    });

    it("returns undefined for null", () => {
      expect(sanitiseSignupSource(null)).toBeUndefined();
    });
  });

  describe("parseSignupSourceParam", () => {
    it("parses a JSON source", () => {
      expect(parseSignupSourceParam('{"sourceUtmSource":"reddit","sourceUtmCampaign":"r_rpg"}')).toEqual({
        sourceUtmSource: "reddit",
        sourceUtmCampaign: "r_rpg",
      });
    });

    it("returns undefined for malformed JSON", () => {
      expect(parseSignupSourceParam("not json")).toBeUndefined();
    });

    it("returns undefined for an oversized string", () => {
      expect(parseSignupSourceParam("x".repeat(5000))).toBeUndefined();
    });

    it("returns undefined when nothing is passed", () => {
      expect(parseSignupSourceParam(undefined)).toBeUndefined();
    });
  });

  describe("hasSignupSource", () => {
    it("is true when a field is set", () => {
      expect(hasSignupSource({ sourceReferrer: "enworld.org" })).toBe(true);
    });

    it("is false for an empty record", () => {
      expect(hasSignupSource({})).toBe(false);
    });

    it("is false for null", () => {
      expect(hasSignupSource(null)).toBe(false);
    });
  });
});
