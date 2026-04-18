import { buildFilterClauses } from "../build-filter-clauses";

describe("buildFilterClauses", () => {
  it("returns empty clause and empty params for no filters", () => {
    const { clause, params } = buildFilterClauses({ nodeAlias: "account", filters: [], paramPrefix: "f" });
    expect(clause).toBe("");
    expect(params).toEqual({});
  });

  it("emits parameterised WHERE for eq", () => {
    const { clause, params } = buildFilterClauses({
      nodeAlias: "account",
      filters: [{ field: "status", op: "eq", value: "open" }],
      paramPrefix: "f",
    });
    expect(clause).toBe("account.status = $f_0");
    expect(params).toEqual({ f_0: "open" });
  });

  it("emits case-insensitive CONTAINS for like", () => {
    const { clause, params } = buildFilterClauses({
      nodeAlias: "account",
      filters: [{ field: "name", op: "like", value: "Acme" }],
      paramPrefix: "f",
    });
    expect(clause).toBe("toLower(account.name) CONTAINS toLower($f_0)");
    expect(params).toEqual({ f_0: "Acme" });
  });

  it("emits IN for array value", () => {
    const { clause, params } = buildFilterClauses({
      nodeAlias: "account",
      filters: [{ field: "status", op: "in", value: ["open", "draft"] }],
      paramPrefix: "f",
    });
    expect(clause).toBe("account.status IN $f_0");
    expect(params).toEqual({ f_0: ["open", "draft"] });
  });

  it("emits IS NULL / IS NOT NULL without binding a value", () => {
    const { clause, params } = buildFilterClauses({
      nodeAlias: "account",
      filters: [
        { field: "closedAt", op: "isNull" },
        { field: "name", op: "isNotNull" },
      ],
      paramPrefix: "f",
    });
    expect(clause).toBe("account.closedAt IS NULL AND account.name IS NOT NULL");
    expect(params).toEqual({});
  });

  it("joins multiple filters with AND", () => {
    const { clause, params } = buildFilterClauses({
      nodeAlias: "account",
      filters: [
        { field: "status", op: "eq", value: "open" },
        { field: "createdAt", op: "gte", value: "2026-01-01" },
      ],
      paramPrefix: "f",
    });
    expect(clause).toBe("account.status = $f_0 AND account.createdAt >= $f_1");
    expect(params).toEqual({ f_0: "open", f_1: "2026-01-01" });
  });

  it("emits parameterised fragments for ne / gt / lt / lte comparisons", () => {
    const { clause, params } = buildFilterClauses({
      nodeAlias: "order",
      filters: [
        { field: "status", op: "ne", value: "cancelled" },
        { field: "total", op: "gt", value: 0 },
        { field: "total", op: "lt", value: 10000 },
        { field: "total", op: "lte", value: 5000 },
      ],
      paramPrefix: "f",
    });
    expect(clause).toBe("order.status <> $f_0 AND order.total > $f_1 AND order.total < $f_2 AND order.total <= $f_3");
    expect(params).toEqual({ f_0: "cancelled", f_1: 0, f_2: 10000, f_3: 5000 });
  });

  it("rejects unsupported operator", () => {
    expect(() =>
      buildFilterClauses({
        nodeAlias: "account",
        filters: [{ field: "x", op: "regex" as any, value: "foo" }],
        paramPrefix: "f",
      }),
    ).toThrow(/Unsupported operator/);
  });

  it("rejects identifiers that are not plain word characters (injection defence)", () => {
    expect(() =>
      buildFilterClauses({
        nodeAlias: "account",
        filters: [{ field: "status; DROP ALL", op: "eq", value: "open" }],
        paramPrefix: "f",
      }),
    ).toThrow(/Invalid field identifier/);
  });
});
