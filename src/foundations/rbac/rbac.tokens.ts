/**
 * DI token for the declarative RBAC matrix.
 *
 * Applications provide an `RbacMatrix` under this token; `RbacReconcilerService`
 * reads it at bootstrap and reconciles Neo4j against it.
 *
 * Note: `MODULE_USER_PATHS_TOKEN` already lives in `rbac.constants.ts` — import
 * it from there rather than duplicating it here.
 */
export const RBAC_MATRIX_TOKEN = Symbol("RBAC_MATRIX_TOKEN");

/**
 * DI token carrying the bootstrap option `permissions.enforce` (boolean).
 *
 * Provided globally by the generated app module. Every consumer injects it
 * `@Optional()` and treats a missing value as `false`, so an app that never
 * sets the option behaves exactly as before.
 */
export const PERMISSIONS_ENFORCE = Symbol("PERMISSIONS_ENFORCE");
