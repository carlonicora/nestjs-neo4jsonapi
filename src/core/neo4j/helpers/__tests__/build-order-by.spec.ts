import { BadRequestException } from "@nestjs/common";
import { buildLegacyOrderByClause, buildOrderByClause } from "../build-order-by";

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

describe("buildLegacyOrderByClause", () => {
  it("keeps a property name and an optional direction", () => {
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", orderBy: "name" })).toBe("ORDER BY scene.name");
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", orderBy: "number desc" })).toBe("ORDER BY scene.number DESC");
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", orderBy: "  createdAt   ASC " })).toBe(
      "ORDER BY scene.createdAt ASC",
    );
  });

  it("falls back to the descriptor default, then updatedAt DESC, skipping empty values", () => {
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", fallback: "name ASC" })).toBe("ORDER BY scene.name ASC");
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", orderBy: "", fallback: "" })).toBe(
      "ORDER BY scene.updatedAt DESC",
    );
  });

  it.each([
    "name; MATCH (n) DETACH DELETE n",
    "name UNION MATCH (u:User) RETURN u",
    "name DESC, other",
    "name LIMIT 0",
    "n.name",
    "name`",
    "name DESC\nRETURN 1",
    "name /* x */",
  ])("refuses %j with a 400 (Cypher injection through ?orderBy=)", (orderBy) => {
    expect(() => buildLegacyOrderByClause({ nodeAlias: "scene", orderBy })).toThrow(BadRequestException);
  });

  it("refuses an injected descriptor default too", () => {
    expect(() => buildLegacyOrderByClause({ nodeAlias: "scene", fallback: "name; DROP" })).toThrow(BadRequestException);
  });
});
