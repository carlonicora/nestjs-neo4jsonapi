import { vi } from "vitest";
import { UserModulesRepository } from "../user-modules.repository";

describe("UserModulesRepository", () => {
  function makeNeo4j(rows: Array<{ moduleId: string | null }>) {
    return {
      read: vi.fn(async () => ({
        records: rows.map((row) => ({ get: (key: string) => (row as any)[key] })),
      })),
    } as any;
  }

  it("returns empty array for empty roleIds without querying Neo4j", async () => {
    const neo4j = makeNeo4j([]);
    const repo = new UserModulesRepository(neo4j);
    expect(await repo.findModuleIdsForRoles([])).toEqual([]);
    expect(neo4j.read).not.toHaveBeenCalled();
  });

  it("returns raw UUID strings from m.id without any normalisation", async () => {
    const neo4j = makeNeo4j([
      { moduleId: "11111111-1111-1111-1111-111111111111" },
      { moduleId: "22222222-2222-2222-2222-222222222222" },
      { moduleId: "33333333-3333-3333-3333-333333333333" },
    ]);
    const repo = new UserModulesRepository(neo4j);
    expect(await repo.findModuleIdsForRoles(["role-1"])).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
    ]);
  });

  it("drops null and empty module ids", async () => {
    const neo4j = makeNeo4j([{ moduleId: null }, { moduleId: "" }, { moduleId: "44444444-4444-4444-4444-444444444444" }]);
    const repo = new UserModulesRepository(neo4j);
    expect(await repo.findModuleIdsForRoles(["r1"])).toEqual(["44444444-4444-4444-4444-444444444444"]);
  });
});
