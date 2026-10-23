import { SetMetadata } from "@nestjs/common";
import type { RbacAction } from "../../foundations/rbac/services/rbac-permission.service";

/**
 * The permission section (a `(Module)` id) a route belongs to, and optionally
 * the action it is checked as.
 *
 * - `module`: the section id. Class-level, it covers every route of the
 *   controller; handler-level, it overrides the class section.
 * - `action`: overrides the HTTP-method mapping (GET/HEAD read, POST create,
 *   PUT/PATCH update, DELETE delete). Use it for a POST that only reads
 *   (search, preview, count): `{ module, action: "read" }`.
 */
export type ModuleDefinition = {
  module: string;
  action?: RbacAction;
  /** @deprecated Never read by anything; kept so existing callers still compile. */
  allowVisitors?: boolean;
};

/** Metadata key read by `ModulePermissionGate` and `ModulePermissionAuditService`. */
export const MODULE_ACL_METADATA = "moduleDefinition";

/**
 * Declares the permission section of a controller (class) or a route (handler).
 * Enforced only when the app bootstraps with `permissions: { enforce: true }`.
 */
export const ModuleACL = (params: ModuleDefinition) => SetMetadata(MODULE_ACL_METADATA, params);
