// packages/nestjs-neo4jsonapi/src/foundations/rbac/serializer/__tests__/matrix-to-ts.spec.ts
import { serializeMatrixToTs } from "../matrix-to-ts";
import { perm } from "../../dsl/perm";
import type { RbacMatrix } from "../../dsl/types";

const MATRIX: RbacMatrix = {
  "mod-uuid-a": {
    default: [perm.read],
    "role-uuid-admin": perm.full,
    "role-uuid-wm": [perm.create, perm.update("warehouse.managedBy")],
  },
  "mod-uuid-b": {
    default: [],
    "role-uuid-admin": perm.full,
  },
};

const ROLE_NAMES: Record<string, string> = {
  "role-uuid-admin": "Administrator",
  "role-uuid-wm": "WarehouseManager",
};
const MODULE_NAMES: Record<string, string> = {
  "mod-uuid-a": "Part",
  "mod-uuid-b": "Warehouse",
};

describe("serializeMatrixToTs", () => {
  it("produces parseable TypeScript that imports the declared symbols", async () => {
    const source = await serializeMatrixToTs(MATRIX, { roleNames: ROLE_NAMES, moduleNames: MODULE_NAMES });
    expect(source).toContain(`import { RoleId, ModuleId } from "@neural-erp/shared"`);
    expect(source).toContain(`import { perm, defineRbac } from "@carlonicora/nestjs-neo4jsonapi"`);
    expect(source).toContain(`[ModuleId.Part]`);
    expect(source).toContain(`[ModuleId.Warehouse]`);
    expect(source).toContain(`[RoleId.WarehouseManager]`);
    expect(source).toContain(`perm.update("warehouse.managedBy")`);
    expect(source).toContain(`perm.full`);
  });

  it("emits deterministic output for semantically equal inputs", async () => {
    const a = await serializeMatrixToTs(MATRIX, { roleNames: ROLE_NAMES, moduleNames: MODULE_NAMES });
    // Shuffle key order in matrix
    const shuffled: RbacMatrix = {
      "mod-uuid-b": MATRIX["mod-uuid-b"]!,
      "mod-uuid-a": MATRIX["mod-uuid-a"]!,
    };
    const b = await serializeMatrixToTs(shuffled, { roleNames: ROLE_NAMES, moduleNames: MODULE_NAMES });
    expect(a).toBe(b);
  });

  it("uses perm.full when all four actions are unconditional", async () => {
    const m: RbacMatrix = {
      "mod-uuid-a": {
        default: [],
        "role-uuid-admin": [perm.read, perm.create, perm.update, perm.delete],
      },
    };
    const src = await serializeMatrixToTs(m, { roleNames: ROLE_NAMES, moduleNames: MODULE_NAMES });
    expect(src).toContain("perm.full");
    expect(src).not.toContain("perm.read,");
  });
});
