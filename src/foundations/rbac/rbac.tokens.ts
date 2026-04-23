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
