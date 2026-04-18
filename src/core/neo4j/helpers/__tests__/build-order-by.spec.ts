import { buildOrderByClause } from "../build-order-by";

describe("buildOrderByClause", () => {
  it("returns empty string for empty array", () => {
    expect(buildOrderByClause({ nodeAlias: "account", sort: [] })).toBe("");
  });

  it("emits single-key ORDER BY", () => {
    expect(
      buildOrderByClause({
        nodeAlias: "account",
        sort: [{ field: "createdAt", direction: "desc" }],
      }),
    ).toBe("ORDER BY account.createdAt DESC");
  });

  it("emits multi-key ORDER BY preserving order", () => {
    expect(
      buildOrderByClause({
        nodeAlias: "account",
        sort: [
          { field: "status", direction: "asc" },
          { field: "createdAt", direction: "desc" },
        ],
      }),
    ).toBe("ORDER BY account.status ASC, account.createdAt DESC");
  });

  it("rejects non-identifier field names (injection defence)", () => {
    expect(() =>
      buildOrderByClause({
        nodeAlias: "account",
        sort: [{ field: "name; DROP", direction: "asc" }],
      }),
    ).toThrow(/Invalid field identifier/);
  });
});
