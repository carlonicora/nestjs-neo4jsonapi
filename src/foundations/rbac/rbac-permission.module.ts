import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { RbacPermissionRepository } from "./repositories/rbac-permission.repository";
import { ModulePermissionAuditService } from "./services/module-permission-audit.service";
import { ModulePermissionGate } from "./services/module-permission.gate";
import { ModulePermissionService } from "./services/module-permission.service";
import { RbacPermissionService } from "./services/rbac-permission.service";

/**
 * Standalone provider module for RBAC permission checks.
 *
 * Deliberately separate from `RbacModule`: that module is a dynamic module
 * (`RbacModule.register({ moduleUserPaths, ... })`) requiring app-level
 * configuration, so it cannot be imported by library modules (e.g. the MCP
 * module) that only need `RbacPermissionService.can()`. This module has no
 * configuration and no controllers — `Neo4jService` is available through the
 * global core module, mirroring how `GraphModule` provides
 * `UserModulesRepository` without importing `Neo4JModule`.
 *
 * Global so the session guards, which are instantiated in every controller's
 * module, can inject `ModulePermissionGate`. The generated app module imports
 * it; every service in it is inert while `permissions.enforce` is off.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    RbacPermissionRepository,
    RbacPermissionService,
    ModulePermissionService,
    ModulePermissionGate,
    ModulePermissionAuditService,
  ],
  exports: [RbacPermissionRepository, RbacPermissionService, ModulePermissionService, ModulePermissionGate],
})
export class RbacPermissionModule {}
