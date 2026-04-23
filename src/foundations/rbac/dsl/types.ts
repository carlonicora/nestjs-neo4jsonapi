// packages/nestjs-neo4jsonapi/src/foundations/rbac/dsl/types.ts

export type Action = "read" | "create" | "update" | "delete";

/**
 * A single permission token. Either unconditional (`scope: true`) or scoped to
 * a dotted path into the frontend model (`scope: "warehouse.managedBy"`).
 *
 * The `M` type parameter constrains scoped paths to those valid for the
 * module the token is declared under. Unconditional tokens are any-module
 * (scope: true) so they have no module constraint.
 */
export type PermToken<PathSet extends string = string> =
  | { action: Action; scope: true }
  | { action: Action; scope: PathSet };

/**
 * Permissions block for a single module in the matrix.
 *
 * `default` applies to every role for this module (the floor).
 * Each role key declares *additions* on top of defaults.
 */
export type ModuleBlock<PathSet extends string = string> = {
  default: PermToken<PathSet>[];
} & Record<string, PermToken<PathSet>[]>;

/**
 * The full RBAC matrix.
 *
 * Keys are module UUIDs (values of `ModuleId`). The `ModuleUserPaths` generic
 * constrains the key set to known modules; scoped paths are typed as `string`
 * (not narrowed per-module), because:
 *   1. Many modules legitimately have no BFS-discovered relationship paths, so
 *      per-module narrowing would collapse their scope type to `never` and
 *      reject any scoped token.
 *   2. Self-scope paths (e.g. `"id"` on User) and attribute paths are not part
 *      of the relationship-based `MODULE_USER_PATHS` set, but are valid at
 *      runtime.
 * Action names remain strictly typed.
 */
export type RbacMatrix<ModuleUserPaths extends Record<string, readonly string[]> = Record<string, readonly string[]>> =
  {
    [M in keyof ModuleUserPaths]?: ModuleBlock<string>;
  };

/**
 * Effective permissions for a single role on a single module, after union of
 * default and role-specific tokens. Matches the shape that the existing
 * permissionQuery writes to Neo4j.
 */
export interface ResolvedPermissions {
  create: boolean | string;
  read: boolean | string;
  update: boolean | string;
  delete: boolean | string;
}

export const ACTION_ORDER: readonly Action[] = ["read", "create", "update", "delete"] as const;
