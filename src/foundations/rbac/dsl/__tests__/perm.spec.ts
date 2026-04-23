// packages/nestjs-neo4jsonapi/src/foundations/rbac/dsl/__tests__/perm.spec.ts
import { perm } from "../perm";

describe("perm factory", () => {
  it("exposes unconditional tokens for each action", () => {
    // perm.* values are callable hybrids (function + attached own properties).
    // Vitest's toEqual treats functions as opaque, so compare fields explicitly.
    expect(perm.read.action).toBe("read");
    expect(perm.read.scope).toBe(true);
    expect(perm.create.action).toBe("create");
    expect(perm.create.scope).toBe(true);
    expect(perm.update.action).toBe("update");
    expect(perm.update.scope).toBe(true);
    expect(perm.delete.action).toBe("delete");
    expect(perm.delete.scope).toBe(true);
  });

  it("update(path) yields a scoped token", () => {
    expect(perm.update("warehouse.managedBy")).toEqual({
      action: "update",
      scope: "warehouse.managedBy",
    });
  });

  it("read(path), create(path), delete(path) are callable", () => {
    expect(perm.read("createdBy")).toEqual({ action: "read", scope: "createdBy" });
    expect(perm.create("createdBy")).toEqual({ action: "create", scope: "createdBy" });
    expect(perm.delete("createdBy")).toEqual({ action: "delete", scope: "createdBy" });
  });

  it("full is an array of four unconditional tokens in action order", () => {
    expect(perm.full).toEqual([
      { action: "read", scope: true },
      { action: "create", scope: true },
      { action: "update", scope: true },
      { action: "delete", scope: true },
    ]);
  });
});
