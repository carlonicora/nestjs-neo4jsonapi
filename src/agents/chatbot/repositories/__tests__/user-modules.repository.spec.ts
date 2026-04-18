import { vi } from "vitest";
import { UserModulesRepository } from "../user-modules.repository";

describe("UserModulesRepository", () => {
  function makeNeo4j(rows: Array<{ moduleName: string | null }>) {
    return {
      read: vi.fn(async () => ({
        records: rows.map((row) => ({ get: (key: string) => (row as any)[key] })),
      })),
    } as any;
  }

  it("returns empty array for empty roleIds without querying Neo4j", async () => {
    const neo4j = makeNeo4j([]);
    const repo = new UserModulesRepository(neo4j);
    expect(await repo.findModulesForRoles([])).toEqual([]);
    expect(neo4j.read).not.toHaveBeenCalled();
  });

  it("lowercases and strips whitespace from module names", async () => {
    const neo4j = makeNeo4j([
      { moduleName: "CRM" },
      { moduleName: "Sales Orders" },
      { moduleName: "procurement" },
    ]);
    const repo = new UserModulesRepository(neo4j);
    expect(await repo.findModulesForRoles(["role-1"])).toEqual([
      "crm",
      "salesorders",
      "procurement",
    ]);
  });

  it("drops null and empty module names", async () => {
    const neo4j = makeNeo4j([
      { moduleName: null },
      { moduleName: "" },
      { moduleName: "Warehouse" },
    ]);
    const repo = new UserModulesRepository(neo4j);
    expect(await repo.findModulesForRoles(["r1"])).toEqual(["warehouse"]);
  });
});
