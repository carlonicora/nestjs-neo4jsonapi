import { RbacMatrix } from "./types";
import { toPermissionsJson } from "./to-permissions-json";

/**
 * Compute the canonical edge JSON for a given (role, module) pair.
 * Union of module defaults and role-specific tokens, serialised.
 * Returns undefined if the role or module is not declared.
 */
export function resolveForRole(matrix: RbacMatrix, roleId: string, moduleId: string): string | undefined {
  const block = matrix[moduleId];
  if (!block) return undefined;
  const roleTokens = block[roleId];
  if (roleTokens === undefined) return undefined;
  return toPermissionsJson([...block.default, ...roleTokens]);
}

/**
 * Compute the canonical defaults JSON for a module.
 * Returns undefined if the module is not declared.
 */
export function resolveDefault(matrix: RbacMatrix, moduleId: string): string | undefined {
  const block = matrix[moduleId];
  if (!block) return undefined;
  return toPermissionsJson(block.default);
}

/**
 * Yield every (role, module) pair declared in the matrix.
 */
export function* iterateDeclaredEdges(matrix: RbacMatrix): Iterable<{ roleId: string; moduleId: string }> {
  for (const [moduleId, block] of Object.entries(matrix)) {
    if (!block) continue;
    for (const key of Object.keys(block)) {
      if (key === "default") continue;
      yield { roleId: key, moduleId };
    }
  }
}

/**
 * Yield every module declared in the matrix.
 */
export function* iterateDeclaredModules(matrix: RbacMatrix): Iterable<string> {
  for (const moduleId of Object.keys(matrix)) {
    if (matrix[moduleId]) yield moduleId;
  }
}
