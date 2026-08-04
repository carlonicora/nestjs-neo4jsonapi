// packages/nestjs-neo4jsonapi/src/foundations/rbac/serializer/matrix-to-ts.ts
// `prettier` is dynamically imported inside `serializeMatrixToTs` so consumers
// don't need it installed in production. The dev controller that calls this
// serialiser is registered only when `RbacModule.register({ devMode: true })`.
import type { RbacMatrix, PermToken } from "../dsl/types";

/**
 * Import lines emitted at the head of the generated file when the caller does
 * not supply `importLines`. These are the neural-erp conventions and are kept
 * verbatim so the default output stays byte-identical for existing consumers.
 */
export const DEFAULT_IMPORT_LINES: readonly string[] = [
  `import { RoleId, ModuleId } from "@neural-erp/shared";`,
  `import { perm, defineRbac } from "@carlonicora/nestjs-neo4jsonapi";`,
  `import { MODULE_USER_PATHS } from "../features/rbac/module-relationships.map";`,
];

interface Options {
  roleNames: Record<string, string>; // UUID → PascalCase (e.g. "WarehouseManager")
  moduleNames: Record<string, string>;

  /**
   * Import lines emitted verbatim at the head of the generated file, in order.
   * Supply this when the consuming app's `RoleId` / `ModuleId` / module-paths
   * map do not live where {@link DEFAULT_IMPORT_LINES} expects them — the
   * generated file must be re-generatable without hand-editing its header.
   * Omit to keep the default (byte-identical) output.
   */
  importLines?: string[];
}

/**
 * Serialise an RbacMatrix to formatted TypeScript source.
 * Deterministic: module and role keys are sorted by UUID; tokens are
 * normalised per action.
 */
export async function serializeMatrixToTs(matrix: RbacMatrix, opts: Options): Promise<string> {
  const prettier = (await import("prettier")).default;
  const moduleIds = Object.keys(matrix).sort();
  const lines: string[] = [];
  lines.push(`// Auto-maintained by the RBAC UI. Edit via \`pnpm dev\` + UI, or by hand.`);
  lines.push(``);
  for (const line of opts?.importLines ?? DEFAULT_IMPORT_LINES) lines.push(line);
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
    valid.length === 4 && valid.every((t) => t.scope === true) && new Set(valid.map((t) => t.action)).size === 4;
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
