import { types } from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { convertFieldValue } from "../define-entity";

const { DateTime } = types;

describe("convertFieldValue — datetime", () => {
  it("converts a DateTime stored with an offset to the right instant", () => {
    const value = new DateTime(2026, 10, 6, 18, 30, 0, 0, 0);
    expect((convertFieldValue(value, "datetime") as Date).toISOString()).toBe("2026-10-06T18:30:00.000Z");
  });

  it("converts a DateTime stored with a named zone (prints as ...Z[UTC]) instead of returning Invalid Date", () => {
    const value = new DateTime(2026, 5, 11, 20, 0, 0, 0, 0, "UTC");
    expect(String(value)).toContain("[UTC]");
    expect((convertFieldValue(value, "datetime") as Date).toISOString()).toBe("2026-05-11T20:00:00.000Z");
  });

  it("applies the offset the server sent with a named zone", () => {
    // As returned by the database: 20:00 in Rome during summer time (+02:00) is 18:00 UTC.
    const value = new DateTime(2026, 5, 11, 20, 0, 0, 0, 7200, "Europe/Rome");
    expect((convertFieldValue(value, "datetime") as Date).toISOString()).toBe("2026-05-11T18:00:00.000Z");
  });

  it("keeps the previous behaviour for a zone name with no offset instead of guessing the server zone", () => {
    const value = new DateTime(2026, 5, 11, 20, 0, 0, 0, undefined, "Europe/Rome");
    expect(Number.isNaN((convertFieldValue(value, "datetime") as Date).getTime())).toBe(true);
  });

  it("still converts an ISO string", () => {
    expect((convertFieldValue("2026-05-11T20:00:00.000Z", "datetime") as Date).toISOString()).toBe(
      "2026-05-11T20:00:00.000Z",
    );
  });

  it("converts every element of a datetime[] field", () => {
    const values = [new DateTime(2026, 5, 11, 20, 0, 0, 0, 0, "UTC"), new DateTime(2026, 10, 6, 18, 30, 0, 0, 0)];
    expect((convertFieldValue(values, "datetime[]") as Date[]).map((d) => d.toISOString())).toEqual([
      "2026-05-11T20:00:00.000Z",
      "2026-10-06T18:30:00.000Z",
    ]);
  });
});
