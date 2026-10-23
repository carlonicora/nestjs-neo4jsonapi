export { RbacModule } from "./rbac.module";
export { RbacPermissionModule } from "./rbac-permission.module";
export { RbacPermissionService } from "./services/rbac-permission.service";
export type { RbacAction } from "./services/rbac-permission.service";
export { RbacPermissionRepository } from "./repositories/rbac-permission.repository";
export { MODULE_USER_PATHS_TOKEN } from "./rbac.constants";
export { PERMISSIONS_ENFORCE } from "./rbac.tokens";

// Request permission gate (bootstrap option `permissions: { enforce: true }`).
export { ModulePermissionService } from "./services/module-permission.service";
export type { EffectivePermissions } from "./services/module-permission.service";
export { ModulePermissionGate, rbacActionForHttpMethod, resolveRouteAcl } from "./services/module-permission.gate";
export { ModulePermissionAuditService } from "./services/module-permission-audit.service";
export { permissionMappingMeta } from "./entities/permission-mapping.meta";
export { modulePathsMeta } from "./entities/module-paths.meta";
export type { PermissionMapping } from "./entities/permission-mapping.entity";
export type { ModuleRelationshipPaths } from "./entities/module-paths.entity";

// RBAC DSL — re-export explicitly to avoid `Action` collision with
// `common/enums/action.ts` at the library root.
export { perm, defineRbac, toPermissionsJson } from "./dsl";
export { resolveForRole, resolveDefault, iterateDeclaredEdges, iterateDeclaredModules } from "./dsl";
export { ACTION_ORDER } from "./dsl";
export type { PermToken, ModuleBlock, RbacMatrix, ResolvedPermissions } from "./dsl";

// Developer-only one-shot tool to read the current DB state and emit a
// declarative `permissions.ts` source file. CLI use only — see the JSDoc
// on `dumpRbacMatrix` for the canonical script template.
export { dumpRbacMatrix } from "./dump";
export type { DumpRbacMatrixOptions, DumpRbacMatrixResult } from "./dump";
// Note: the DSL's `Action` string-literal union is intentionally not re-exported
// from the library root; `common/enums/action.ts` already exports an `Action`
// enum with the same string values. Deep consumers can import it via
// `@carlonicora/nestjs-neo4jsonapi/foundations/rbac/dsl` if needed.
