// packages/nestjs-neo4jsonapi/src/foundations/rbac/serializer/matrix-to-ts.ts
import prettier from "prettier";
import type { RbacMatrix, PermToken } from "../dsl/types";

interface Options {
  roleNames: Record<string, string>; // UUID → PascalCase (e.g. "WarehouseManager")
  moduleNames: Record<string, string>;
}

/**
 * Serialise an RbacMatrix to formatted TypeScript source.
 * Deterministic: module and role keys are sorted by UUID; tokens are
 * normalised per action.
 */
export async function serializeMatrixToTs(matrix: RbacMatrix, opts: Options): Promise<string> {
  const moduleIds = Object.keys(matrix).sort();
  const lines: string[] = [];
  lines.push(`// Auto-maintained by the RBAC UI. Edit via \`pnpm dev\` + UI, or by hand.`);
  lines.push(``);
  lines.push(`import { RoleId, ModuleId } from "@neural-erp/shared";`);
  lines.push(`import { perm, defineRbac } from "@carlonicora/nestjs-neo4jsonapi";`);
  lines.push(`import { MODULE_USER_PATHS } from "../features/rbac/module-relationships.map";`);
  lines.push(``);
  lines.push(`export const rbac = defineRbac<typeof MODULE_USER_PATHS>({`);

  for (const moduleId of moduleIds) {
    const block = matrix[moduleId];
    if (!block) continue;
    const moduleName = opts.moduleNames[moduleId];
    if (!moduleName) {
      throw new Error(`Unknown module UUID: ${moduleId}. Check module-id.map.json.`);
    }
    lines.push(`  [ModuleId.${moduleName}]: {`);
    lines.push(`    default: ${renderTokens(block.default)},`);
    const roleIds = Object.keys(block)
      .filter((k) => k !== "default")
      .sort();
    for (const roleId of roleIds) {
      const roleName = opts.roleNames[roleId];
      if (!roleName) throw new Error(`Unknown role UUID: ${roleId}`);
      lines.push(`    [RoleId.${roleName}]: ${renderTokens(block[roleId])},`);
    }
    lines.push(`  },`);
  }
  lines.push(`});`);
  lines.push(``);

  const raw = lines.join("\n");
  return prettier.format(raw, { parser: "typescript" });
}

function renderTokens(tokens: PermToken[]): string {
  // `scope === false` has no emission (absence of a token is the "deny"
  // semantics). Drop defensively before any shape-checking so malformed state
  // never leaks to disk as `perm.X("false")`.
  const valid = tokens.filter((t) => t.scope === true || (typeof t.scope === "string" && t.scope.length > 0));

  // perm.full collapse
  const isFull =
    valid.length === 4 &&
    valid.every((t) => t.scope === true) &&
    new Set(valid.map((t) => t.action)).size === 4;
  if (isFull) return "perm.full";

  if (valid.length === 0) return "[]";

  // Render each token
  const parts = [...valid]
    .sort((a, b) => {
      const order: Record<string, number> = { read: 0, create: 1, update: 2, delete: 3 };
      return order[a.action] - order[b.action];
    })
    .map((t) => {
      if (t.scope === true) return `perm.${t.action}`;
      return `perm.${t.action}("${t.scope}")`;
    });
  return `[${parts.join(", ")}]`;
}
