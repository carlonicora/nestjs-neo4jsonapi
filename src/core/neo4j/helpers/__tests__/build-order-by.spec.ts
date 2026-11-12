import { BadRequestException } from "@nestjs/common";
import {
  buildLegacyOrderByClause,
  buildListOrderByClause,
  buildOrderByClause,
  caseInsensitiveSortKey,
  codeOrderBy,
} from "../build-order-by";

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
    ).toBe("ORDER BY account.createdAt DESC, account.id ASC");
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
    ).toBe(
      "ORDER BY CASE WHEN account.status IS :: STRING THEN toLower(account.status) ELSE account.status END ASC, account.createdAt DESC, account.id ASC",
    );
  });

  it("does not append the id tiebreaker when the last key is already id", () => {
    expect(
      buildOrderByClause({
        nodeAlias: "account",
        sort: [
          { field: "status", direction: "asc" },
          { field: "id", direction: "desc" },
        ],
      }),
    ).toBe(
      "ORDER BY CASE WHEN account.status IS :: STRING THEN toLower(account.status) ELSE account.status END ASC, account.id DESC",
    );
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
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", orderBy: "name" })).toBe("ORDER BY scene.name, scene.id ASC");
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", orderBy: "number desc" })).toBe(
      "ORDER BY scene.number DESC, scene.id ASC",
    );
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", orderBy: "  createdAt   ASC " })).toBe(
      "ORDER BY scene.createdAt ASC, scene.id ASC",
    );
  });

  it("falls back to the descriptor default, then updatedAt DESC, skipping empty values", () => {
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", fallback: "name ASC" })).toBe(
      "ORDER BY scene.name ASC, scene.id ASC",
    );
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", orderBy: "", fallback: "" })).toBe(
      "ORDER BY scene.updatedAt DESC, scene.id ASC",
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

  it("does not append the id tiebreaker when the ordered field is id", () => {
    expect(buildLegacyOrderByClause({ nodeAlias: "scene", orderBy: "id DESC" })).toBe("ORDER BY scene.id DESC");
  });

  it("refuses an injected descriptor default too", () => {
    expect(() => buildLegacyOrderByClause({ nodeAlias: "scene", fallback: "name; DROP" })).toThrow(BadRequestException);
  });
});

describe("buildListOrderByClause", () => {
  const defaultOrderBy = codeOrderBy("scene.updatedAt DESC");

  it("orders by the requested sort, then the id tiebreaker", () => {
    expect(
      buildListOrderByClause({
        nodeAlias: "scene",
        sort: [
          { field: "name", direction: "asc" },
          { field: "createdAt", direction: "desc" },
        ],
        defaultOrderBy,
      }),
    ).toBe(
      "ORDER BY CASE WHEN scene.name IS :: STRING THEN toLower(scene.name) ELSE scene.name END ASC, scene.createdAt DESC, scene.id ASC",
    );
  });

  it("puts the score after the sort keys when the query searched (call C7)", () => {
    expect(
      buildListOrderByClause({
        nodeAlias: "scene",
        sort: [{ field: "name", direction: "asc" }],
        defaultOrderBy,
        scoreVariable: "score",
      }),
    ).toBe(
      "ORDER BY CASE WHEN scene.name IS :: STRING THEN toLower(scene.name) ELSE scene.name END ASC, score DESC, scene.id ASC",
    );
  });

  it("orders by score when the query searched and no sort is requested", () => {
    expect(buildListOrderByClause({ nodeAlias: "scene", defaultOrderBy, scoreVariable: "score" })).toBe(
      "ORDER BY score DESC, scene.id ASC",
    );
    expect(buildListOrderByClause({ nodeAlias: "scene", sort: [], defaultOrderBy, scoreVariable: "score" })).toBe(
      "ORDER BY score DESC, scene.id ASC",
    );
  });

  it("falls back to the code-authored default when there is no sort and no search", () => {
    expect(buildListOrderByClause({ nodeAlias: "scene", defaultOrderBy })).toBe(
      "ORDER BY scene.updatedAt DESC, scene.id ASC",
    );
    expect(
      buildListOrderByClause({
        nodeAlias: "task",
        defaultOrderBy: codeOrderBy("task.dueDate IS NULL, task.dueDate ASC"),
      }),
    ).toBe("ORDER BY task.dueDate IS NULL, task.dueDate ASC, task.id ASC");
  });

  it("replaces the property with a code-authored expression for that field", () => {
    expect(
      buildListOrderByClause({
        nodeAlias: "task",
        sort: [
          { field: "priority", direction: "desc" },
          { field: "name", direction: "asc" },
        ],
        defaultOrderBy,
        expressions: { priority: codeOrderBy("priorityRank") },
      }),
    ).toBe(
      "ORDER BY priorityRank DESC, CASE WHEN task.name IS :: STRING THEN toLower(task.name) ELSE task.name END ASC, task.id ASC",
    );
  });

  it("does not repeat the id tiebreaker when the last requested key is id", () => {
    expect(
      buildListOrderByClause({ nodeAlias: "scene", sort: [{ field: "id", direction: "desc" }], defaultOrderBy }),
    ).toBe("ORDER BY scene.id DESC");
  });

  it("refuses a non-identifier field, alias or score variable", () => {
    expect(() =>
      buildListOrderByClause({ nodeAlias: "scene", sort: [{ field: "name; DROP", direction: "asc" }], defaultOrderBy }),
    ).toThrow(/Invalid field identifier/);
    expect(() => buildListOrderByClause({ nodeAlias: "scene x", defaultOrderBy })).toThrow(/Invalid nodeAlias/);
    expect(() => buildListOrderByClause({ nodeAlias: "scene", defaultOrderBy, scoreVariable: "score)" })).toThrow(
      /Invalid scoreVariable/,
    );
  });
});

describe("caseInsensitiveSortKey", () => {
  it("wraps a text-capable property in a case-insensitive key, leaving id and the timestamps bare", () => {
    expect(caseInsensitiveSortKey("account.name")).toBe(
      "CASE WHEN account.name IS :: STRING THEN toLower(account.name) ELSE account.name END",
    );
    expect(caseInsensitiveSortKey("account.id")).toBe("account.id");
    expect(caseInsensitiveSortKey("account.createdAt")).toBe("account.createdAt");
    expect(caseInsensitiveSortKey("account.updatedAt")).toBe("account.updatedAt");
  });
});

describe("codeOrderBy", () => {
  it("returns the code-authored text unchanged", () => {
    expect(codeOrderBy("scene.name ASC")).toBe("scene.name ASC");
  });

  it("refuses an empty body", () => {
    expect(() => codeOrderBy("  ")).toThrow();
  });
});
