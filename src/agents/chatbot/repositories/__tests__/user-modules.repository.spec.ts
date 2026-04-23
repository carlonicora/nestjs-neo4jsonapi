import { vi } from "vitest";
import { UserModulesRepository } from "../user-modules.repository";

describe("UserModulesRepository", () => {
  type ModuleRow = {
    id: string;
    permissions: string | null;
  };

  function makeNeo4j(rows: Array<ModuleRow | null>) {
    return {
      read: vi.fn(async () => ({
        records: rows.map((row) => ({
          get: (key: string) => (key === "module" ? (row == null ? null : { properties: row }) : undefined),
        })),
      })),
    } as any;
  }

  const READ_TRUE = JSON.stringify([
    { type: "create", value: true },
    { type: "read", value: true },
    { type: "update", value: true },
    { type: "delete", value: true },
  ]);
  const READ_FALSE = JSON.stringify([
    { type: "create", value: false },
    { type: "read", value: false },
    { type: "update", value: false },
    { type: "delete", value: false },
  ]);
  const READ_ONLY = JSON.stringify([{ type: "read", value: true }]);

  it("returns module ids where effective read permission is true", async () => {
    const neo4j = makeNeo4j([
      { id: "11111111-1111-1111-1111-111111111111", permissions: READ_TRUE },
      { id: "22222222-2222-2222-2222-222222222222", permissions: READ_TRUE },
      { id: "33333333-3333-3333-3333-333333333333", permissions: READ_ONLY },
    ]);
    const repo = new UserModulesRepository(neo4j);
    expect(await repo.findModuleIdsForUser("user-1")).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
    ]);
    expect(neo4j.read).toHaveBeenCalledOnce();
  });

  it("excludes modules where read is false or absent", async () => {
    const neo4j = makeNeo4j([
      { id: "11111111-1111-1111-1111-111111111111", permissions: READ_TRUE },
      { id: "22222222-2222-2222-2222-222222222222", permissions: READ_FALSE },
      { id: "33333333-3333-3333-3333-333333333333", permissions: JSON.stringify([]) },
    ]);
    const repo = new UserModulesRepository(neo4j);
    expect(await repo.findModuleIdsForUser("user-1")).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  it("drops rows with null module, missing id, missing permissions, or malformed JSON", async () => {
    const neo4j = makeNeo4j([
      null,
      { id: "", permissions: READ_TRUE },
      { id: "11111111-1111-1111-1111-111111111111", permissions: null },
      { id: "22222222-2222-2222-2222-222222222222", permissions: "not-json" },
      { id: "44444444-4444-4444-4444-444444444444", permissions: READ_TRUE },
    ]);
    const repo = new UserModulesRepository(neo4j);
    expect(await repo.findModuleIdsForUser("user-1")).toEqual(["44444444-4444-4444-4444-444444444444"]);
  });
});
