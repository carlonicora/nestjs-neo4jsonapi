import { Inject, Injectable, OnApplicationBootstrap, Optional, RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { MODULE_ACL_METADATA } from "../../../common/decorators/module.decorator";
import type { ModuleDefinition } from "../../../common/decorators/module.decorator";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { OptionalJwtAuthGuard } from "../../../common/guards/jwt.auth.optional.guard";
import { RbacPermissionRepository } from "../repositories/rbac-permission.repository";
import { PERMISSIONS_ENFORCE } from "../rbac.tokens";
import { resolveRouteAcl } from "./module-permission.gate";

/** The guards that run `ModulePermissionGate`. Subclasses count too. */
const SESSION_GUARDS: Array<abstract new (...args: any[]) => unknown> = [
  JwtAuthGuard,
  AdminJwtAuthGuard,
  OptionalJwtAuthGuard,
];

const WRITE_ACTIONS = new Set(["create", "update", "delete"]);

interface AuditedRoute {
  label: string;
  module: string | undefined;
  isWrite: boolean;
}

function isSessionGuard(guard: unknown): boolean {
  const type: any = typeof guard === "function" ? guard : (guard as any)?.constructor;
  if (typeof type !== "function") return false;
  return SESSION_GUARDS.some((g) => type === g || type.prototype instanceof g);
}

function joinPaths(prefix: unknown, path: unknown): string {
  const first = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? "") : String(value ?? ""));
  const parts = [first(prefix), first(path)].map((p) => p.replace(/^\/+|\/+$/g, "")).filter((p) => p.length);
  return `/${parts.join("/")}`;
}

/**
 * Boot audit for the permission gate. Runs only when the app bootstraps with
 * `permissions: { enforce: true }` (API and worker).
 *
 * Refuses to start when:
 * - a route guarded by a session guard is a write (POST/PUT/PATCH/DELETE, or a
 *   `@ModuleACL` action that is a write) and has no section;
 * - a section id referenced by any session-guarded route has no `(:Module)` node.
 *
 * This is what makes the gate fail closed for writes at startup instead of at
 * request time.
 */
@Injectable()
export class ModulePermissionAuditService implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly repository: RbacPermissionRepository,
    @Optional()
    @Inject(PERMISSIONS_ENFORCE)
    private readonly enforce?: boolean,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.enforce !== true) return;
    await this.audit();
  }

  /** Every session-guarded route with its resolved section. Exposed for tests. */
  collectRoutes(): AuditedRoute[] {
    const routes: AuditedRoute[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype as any;
      if (typeof controller !== "function" || !controller.prototype) continue;

      const prototype = controller.prototype;
      const classGuards: unknown[] = this.reflector.get(GUARDS_METADATA, controller) ?? [];
      const classDefinition = this.reflector.get<ModuleDefinition>(MODULE_ACL_METADATA, controller);
      const controllerPath = this.reflector.get(PATH_METADATA, controller);

      for (const methodName of this.metadataScanner.getAllMethodNames(prototype)) {
        const handler = prototype[methodName];
        if (typeof handler !== "function") continue;

        const requestMethod = this.reflector.get<RequestMethod>(METHOD_METADATA, handler);
        const routePath = this.reflector.get(PATH_METADATA, handler);
        if (requestMethod === undefined || routePath === undefined) continue;

        const handlerGuards: unknown[] = this.reflector.get(GUARDS_METADATA, handler) ?? [];
        if (![...classGuards, ...handlerGuards].some(isSessionGuard)) continue;

        const method = RequestMethod[requestMethod] ?? String(requestMethod);
        const { module, action } = resolveRouteAcl({
          classDefinition,
          handlerDefinition: this.reflector.get<ModuleDefinition>(MODULE_ACL_METADATA, handler),
          method,
        });

        routes.push({
          label: `${method} ${joinPaths(controllerPath, routePath)} (${controller.name}.${methodName})`,
          module,
          isWrite: WRITE_ACTIONS.has(action),
        });
      }
    }

    return routes;
  }

  async audit(): Promise<void> {
    const routes = this.collectRoutes();

    const unsectioned = routes.filter((r) => r.isWrite && !r.module).map((r) => r.label);
    if (unsectioned.length > 0) {
      throw new Error(
        `Permission audit failed: ${unsectioned.length} session-guarded write route(s) have no @ModuleACL section:\n` +
          unsectioned.map((label) => `  - ${label}`).join("\n"),
      );
    }

    const referenced = Array.from(new Set(routes.map((r) => r.module).filter((m): m is string => !!m))).sort();
    const existing = await this.repository.findExistingModuleIds(referenced);
    const missing = referenced.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      const byModule = missing.map((id) => {
        const example = routes.find((r) => r.module === id)?.label ?? "";
        return `  - ${id} (e.g. ${example})`;
      });
      throw new Error(
        `Permission audit failed: ${missing.length} section id(s) referenced by @ModuleACL have no (:Module) node. ` +
          `Seed them in a migration before switching permissions.enforce on:\n` +
          byModule.join("\n"),
      );
    }
  }
}
