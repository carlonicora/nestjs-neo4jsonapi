// define-rbac.ts
import type { RbacMatrix } from "./types";

/**
 * Identity function used to attach typing to an rbac matrix literal.
 *
 * The generic parameter binds the matrix to a concrete `MODULE_USER_PATHS`
 * shape so that scoped-path arguments in `perm.update("...")` etc. are
 * type-checked against the module they are declared under.
 *
 * Usage:
 *   export const rbac = defineRbac<typeof MODULE_USER_PATHS>({
 *     [ModuleId.Part]: { default: [perm.read], ... },
 *   });
 */
export function defineRbac<ModuleUserPaths extends Record<string, readonly string[]>>(
  matrix: RbacMatrix<ModuleUserPaths>,
): RbacMatrix<ModuleUserPaths> {
  return matrix;
}
