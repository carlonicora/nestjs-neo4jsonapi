import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { normalizeNeo4jTemporal } from "../neo4j-date";

describe("normalizeNeo4jTemporal", () => {
  describe("undefined and null passthrough", () => {
    it("returns undefined when value is undefined (date)", () => {
      expect(normalizeNeo4jTemporal(undefined, "date")).toBeUndefined();
    });

    it("returns undefined when value is undefined (datetime)", () => {
      expect(normalizeNeo4jTemporal(undefined, "datetime")).toBeUndefined();
    });

    it("returns null when value is null (date)", () => {
      expect(normalizeNeo4jTemporal(null, "date")).toBeNull();
    });

    it("returns null when value is null (datetime)", () => {
      expect(normalizeNeo4jTemporal(null, "datetime")).toBeNull();
    });
  });

  describe("Date input", () => {
    it("formats a Date to YYYY-MM-DD in UTC for 'date' type", () => {
      const d = new Date(Date.UTC(2024, 2, 15, 10, 30, 0));
      expect(normalizeNeo4jTemporal(d, "date")).toBe("2024-03-15");
    });

    it("formats a Date to ISO string for 'datetime' type", () => {
      const d = new Date(Date.UTC(2024, 2, 15, 10, 30, 0, 0));
      expect(normalizeNeo4jTemporal(d, "datetime")).toBe("2024-03-15T10:30:00.000Z");
    });

    it("uses UTC components even when local time would shift the calendar day", () => {
      const d = new Date(Date.UTC(2024, 2, 15, 23, 59, 0));
      expect(normalizeNeo4jTemporal(d, "date")).toBe("2024-03-15");
    });

    it("throws BadRequestException for an invalid Date", () => {
      expect(() => normalizeNeo4jTemporal(new Date("not-a-date"), "date")).toThrow(BadRequestException);
    });
  });

  describe("YYYY-MM-DD string input", () => {
    it("passes through unchanged for 'date' type", () => {
      expect(normalizeNeo4jTemporal("2024-03-15", "date")).toBe("2024-03-15");
    });

    it("expands to midnight UTC ISO string for 'datetime' type", () => {
      expect(normalizeNeo4jTemporal("2024-03-15", "datetime")).toBe("2024-03-15T00:00:00.000Z");
    });
  });

  describe("ISO datetime string input", () => {
    it("truncates to date portion for 'date' type", () => {
      expect(normalizeNeo4jTemporal("2024-03-15T10:30:00Z", "date")).toBe("2024-03-15");
    });

    it("truncates ISO with milliseconds for 'date' type", () => {
      expect(normalizeNeo4jTemporal("2024-03-15T10:30:00.123Z", "date")).toBe("2024-03-15");
    });

    it("canonicalizes to full ISO UTC for 'datetime' type", () => {
      expect(normalizeNeo4jTemporal("2024-03-15T10:30:00Z", "datetime")).toBe("2024-03-15T10:30:00.000Z");
    });

    it("throws BadRequestException on unparseable ISO datetime", () => {
      expect(() => normalizeNeo4jTemporal("2024-03-15T99:99:99Z", "datetime")).toThrow(BadRequestException);
    });
  });

  describe("invalid inputs", () => {
    it("throws BadRequestException on garbage string", () => {
      expect(() => normalizeNeo4jTemporal("not-a-date", "date")).toThrow(BadRequestException);
    });

    it("throws BadRequestException on string with wrong prefix format", () => {
      expect(() => normalizeNeo4jTemporal("15/03/2024", "date")).toThrow(BadRequestException);
    });

    it("throws BadRequestException on unsupported type", () => {
      // @ts-expect-error — testing runtime guard
      expect(() => normalizeNeo4jTemporal(12345, "date")).toThrow(BadRequestException);
    });
  });
});
