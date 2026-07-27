import { Module } from "@nestjs/common";
import { RbacPermissionRepository } from "./repositories/rbac-permission.repository";
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
 */
@Module({
  providers: [RbacPermissionRepository, RbacPermissionService],
  exports: [RbacPermissionRepository, RbacPermissionService],
})
export class RbacPermissionModule {}
