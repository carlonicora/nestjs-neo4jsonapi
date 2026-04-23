import { resolveForRole } from "../resolver";
import { perm } from "../perm";
import type { RbacMatrix } from "../types";

const MATRIX: RbacMatrix = {
  "module-uuid-1": {
    default: [perm.read],
    "role-uuid-admin": perm.full,
    "role-uuid-wm": [perm.create, perm.update("warehouse.managedBy")],
    "role-uuid-tech": [],
  },
  "module-uuid-2": {
    default: [],
    "role-uuid-admin": perm.full,
  },
};

describe("resolveForRole", () => {
  it("returns defaults for a role that appears with empty array", () => {
    const json = resolveForRole(MATRIX, "role-uuid-tech", "module-uuid-1");
    expect(JSON.parse(json!)).toEqual([
      { type: "read", value: true },
      { type: "create", value: false },
      { type: "update", value: false },
      { type: "delete", value: false },
    ]);
  });

  it("unions defaults with role-specific tokens", () => {
    const json = resolveForRole(MATRIX, "role-uuid-wm", "module-uuid-1");
    expect(JSON.parse(json!)).toEqual([
      { type: "read", value: true },
      { type: "create", value: true },
      { type: "update", value: "warehouse.managedBy" },
      { type: "delete", value: false },
    ]);
  });

  it("returns undefined for a role not declared on the module", () => {
    // roles absent entirely from the module block inherit defaults-only,
    // but resolveForRole is only called for declared (role, module) pairs;
    // the reconciler uses iterateEdges for enumeration.
    const json = resolveForRole(MATRIX, "role-uuid-unknown", "module-uuid-1");
    expect(json).toBeUndefined();
  });

  it("returns undefined for a module not declared in the matrix", () => {
    const json = resolveForRole(MATRIX, "role-uuid-admin", "unknown-module");
    expect(json).toBeUndefined();
  });
});

describe("iterateDeclaredEdges", () => {
  it("yields all (role, module) pairs declared in the matrix", async () => {
    const { iterateDeclaredEdges } = await import("../resolver");
    const edges = Array.from(iterateDeclaredEdges(MATRIX));
    expect(edges).toEqual(
      expect.arrayContaining([
        { roleId: "role-uuid-admin", moduleId: "module-uuid-1" },
        { roleId: "role-uuid-wm", moduleId: "module-uuid-1" },
        { roleId: "role-uuid-tech", moduleId: "module-uuid-1" },
        { roleId: "role-uuid-admin", moduleId: "module-uuid-2" },
      ]),
    );
    expect(edges.length).toBe(4);
  });
});

describe("resolveDefault", () => {
  it("returns the module's default permissions JSON", async () => {
    const { resolveDefault } = await import("../resolver");
    const json = resolveDefault(MATRIX, "module-uuid-1");
    expect(JSON.parse(json!)).toEqual([
      { type: "read", value: true },
      { type: "create", value: false },
      { type: "update", value: false },
      { type: "delete", value: false },
    ]);
  });

  it("returns empty-defaults JSON for an empty default array", async () => {
    const { resolveDefault } = await import("../resolver");
    const json = resolveDefault(MATRIX, "module-uuid-2");
    expect(JSON.parse(json!)).toEqual([
      { type: "read", value: false },
      { type: "create", value: false },
      { type: "update", value: false },
      { type: "delete", value: false },
    ]);
  });
});
