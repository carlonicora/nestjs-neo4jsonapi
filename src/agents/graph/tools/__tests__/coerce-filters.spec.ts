import { describe, it, expect } from "vitest";
import { coerceFilters, coerceSort, FILTER_OPERATORS } from "../traverse.tool";

describe("coerceFilters", () => {
  it("returns no filters for a missing value", () => {
    expect(coerceFilters(undefined)).toEqual({ filters: [] });
    expect(coerceFilters(null)).toEqual({ filters: [] });
  });

  it("keeps the canonical array untouched", () => {
    const raw = [
      { field: "name", op: "like", value: "acme" },
      { field: "year", op: "in", value: [2023, 2024] },
      { field: "deletedAt", op: "isNull" },
    ];
    expect(coerceFilters(raw)).toEqual({
      filters: [
        { field: "name", op: "like", value: "acme" },
        { field: "year", op: "in", value: [2023, 2024] },
        { field: "deletedAt", op: "isNull", value: undefined },
      ],
    });
  });

  it("accepts a single canonical object", () => {
    expect(coerceFilters({ field: "name", op: "eq", value: "x" })).toEqual({
      filters: [{ field: "name", op: "eq", value: "x" }],
    });
  });

  it("coerces map form scalars to eq", () => {
    expect(coerceFilters({ number: "14345", year: "2024" })).toEqual({
      filters: [
        { field: "number", op: "eq", value: "14345" },
        { field: "year", op: "eq", value: "2024" },
      ],
    });
  });

  it("coerces map form arrays to in", () => {
    expect(coerceFilters({ year: ["2023", "2024"] })).toEqual({
      filters: [{ field: "year", op: "in", value: ["2023", "2024"] }],
    });
  });

  it("rejects a map form object value instead of stringifying it", () => {
    const out = coerceFilters({ year: { gte: 2023 } });
    expect("error" in out).toBe(true);
    expect((out as { error: string }).error).toContain("{ field, op, value }");
  });

  it("rejects an unknown operator with the allowed list", () => {
    const out = coerceFilters([{ field: "number", op: "contains", value: "1" }]);
    expect("error" in out).toBe(true);
    const error = (out as { error: string }).error;
    expect(error).toContain('Operator "contains" is not valid');
    expect(error).toContain(`Allowed: [${FILTER_OPERATORS.join(", ")}]`);
    expect(error).toContain('use "like" for a substring');
  });

  it("rejects an item without field and op", () => {
    const out = coerceFilters([
      { field: "name", op: "eq", value: "x" },
      { number: "1", op: "eq" },
    ]);
    expect("error" in out).toBe(true);
    expect((out as { error: string }).error).toContain("{ field, op, value }");
  });

  it("rejects a non-object item", () => {
    const out = coerceFilters(["name eq x"]);
    expect("error" in out).toBe(true);
    expect((out as { error: string }).error).toContain("{ field, op, value }");
  });

  it("rejects a value of an unsupported shape on a canonical item", () => {
    const out = coerceFilters([{ field: "year", op: "in", value: [2023, "2024"] }]);
    expect("error" in out).toBe(true);
  });
});

describe("coerceSort", () => {
  const errorOf = (out: ReturnType<typeof coerceSort>): string => {
    expect("error" in out).toBe(true);
    return (out as { error: string }).error;
  };

  it("returns no sort for a missing value", () => {
    expect(coerceSort(undefined)).toEqual({ sort: [] });
    expect(coerceSort(null)).toEqual({ sort: [] });
  });

  it("accepts the canonical, single-object, map and string forms", () => {
    expect(coerceSort([{ field: "date", direction: "desc" }])).toEqual({
      sort: [{ field: "date", direction: "desc" }],
    });
    expect(coerceSort({ field: "date" })).toEqual({ sort: [{ field: "date", direction: "asc" }] });
    expect(coerceSort({ date: "desc", name: "asc" })).toEqual({
      sort: [
        { field: "date", direction: "desc" },
        { field: "name", direction: "asc" },
      ],
    });
    expect(coerceSort(["date", "name desc"])).toEqual({
      sort: [
        { field: "date", direction: "asc" },
        { field: "name", direction: "desc" },
      ],
    });
  });

  it("accepts DESC case-insensitively in every form", () => {
    expect(coerceSort("date DESC")).toEqual({ sort: [{ field: "date", direction: "desc" }] });
    expect(coerceSort({ field: "date", direction: "DESC" })).toEqual({
      sort: [{ field: "date", direction: "desc" }],
    });
    expect(coerceSort({ date: "Desc" })).toEqual({ sort: [{ field: "date", direction: "desc" }] });
    expect(coerceSort("date ASC")).toEqual({ sort: [{ field: "date", direction: "asc" }] });
  });

  it("rejects an unknown direction naming asc | desc", () => {
    for (const raw of [
      "date descending",
      { field: "date", direction: "descending" },
      { date: "descending" },
      [{ date: 1 }],
    ]) {
      expect(errorOf(coerceSort(raw))).toContain("asc | desc");
    }
    expect(errorOf(coerceSort("date descending"))).toContain('"descending"');
  });

  it("rejects an item that is not a string, { field, direction } or map form", () => {
    for (const raw of [
      [42],
      [["date", "desc"]],
      [true],
      { field: "date", dir: "desc" },
      { direction: "desc" },
      { field: 3, direction: "asc" },
      {},
      "date desc extra",
      "   ",
    ]) {
      expect(errorOf(coerceSort(raw))).toContain("{ field, direction }");
    }
  });
});
