// packages/nestjs-neo4jsonapi/src/foundations/rbac/serializer/__tests__/matrix-to-ts.spec.ts
import { DEFAULT_IMPORT_LINES, serializeMatrixToTs } from "../matrix-to-ts";
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

  describe("importLines", () => {
    it("emits the default header verbatim when importLines is omitted", async () => {
      const source = await serializeMatrixToTs(MATRIX, { roleNames: ROLE_NAMES, moduleNames: MODULE_NAMES });
      for (const line of DEFAULT_IMPORT_LINES) {
        expect(source).toContain(line);
      }
      expect(DEFAULT_IMPORT_LINES).toEqual([
        `import { RoleId, ModuleId } from "@neural-erp/shared";`,
        `import { perm, defineRbac } from "@carlonicora/nestjs-neo4jsonapi";`,
        `import { MODULE_USER_PATHS } from "../features/rbac/module-relationships.map";`,
      ]);
    });

    it("emits the supplied import lines instead of the defaults", async () => {
      const source = await serializeMatrixToTs(MATRIX, {
        roleNames: ROLE_NAMES,
        moduleNames: MODULE_NAMES,
        importLines: [`import { RoleId } from "./x";`],
      });
      expect(source).toContain(`import { RoleId } from "./x";`);
      expect(source).not.toContain(`@neural-erp/shared`);
      expect(source).not.toContain(`module-relationships.map`);
    });

    it("emits supplied import lines in order", async () => {
      const importLines = [
        `import { RoleId } from "../config/enums/role.id";`,
        `import { ModuleId } from "@avvocato360ai/shared";`,
        `import { perm, defineRbac } from "@carlonicora/nestjs-neo4jsonapi";`,
      ];
      const source = await serializeMatrixToTs(MATRIX, {
        roleNames: ROLE_NAMES,
        moduleNames: MODULE_NAMES,
        importLines,
      });
      const positions = importLines.map((line) => source.indexOf(line));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });

    it("emits no import lines when an empty array is supplied", async () => {
      const source = await serializeMatrixToTs(MATRIX, {
        roleNames: ROLE_NAMES,
        moduleNames: MODULE_NAMES,
        importLines: [],
      });
      expect(source).not.toContain("import ");
      expect(source).toContain("export const rbac = defineRbac");
    });
  });
});
