import { ExecutionContext, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { MODULE_ACL_METADATA } from "../../../common/decorators/module.decorator";
import type { ModuleDefinition } from "../../../common/decorators/module.decorator";
import { PERMISSIONS_ENFORCE } from "../rbac.tokens";
import { ModulePermissionService } from "./module-permission.service";
import type { RbacAction } from "./rbac-permission.service";

/**
 * HTTP method → permission action. GET/HEAD/OPTIONS read, POST create, PUT/PATCH
 * update, DELETE delete. Anything else is treated as a write (update), so an
 * unexpected verb never slips through as a read.
 */
export function rbacActionForHttpMethod(method: string | undefined): RbacAction {
  switch ((method ?? "").toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
      return "read";
    case "POST":
      return "create";
    case "DELETE":
      return "delete";
    default:
      return "update";
  }
}

/**
 * Section and action of a route: the handler `@ModuleACL` wins over the class
 * one, field by field; the action falls back to the HTTP-method mapping.
 */
export function resolveRouteAcl(params: {
  classDefinition: ModuleDefinition | undefined;
  handlerDefinition: ModuleDefinition | undefined;
  method: string | undefined;
}): { module: string | undefined; action: RbacAction } {
  const module = params.handlerDefinition?.module ?? params.classDefinition?.module;
  const action =
    params.handlerDefinition?.action ?? params.classDefinition?.action ?? rbacActionForHttpMethod(params.method);
  return { module: module || undefined, action };
}

/**
 * Request-level permission check, run by the session guards (`JwtAuthGuard`,
 * `AdminJwtAuthGuard`, `OptionalJwtAuthGuard`) right after authentication.
 *
 * Off unless the app bootstraps with `permissions: { enforce: true }`: with it
 * off, `assert` returns before reading metadata or touching the database.
 *
 * Rules:
 * - A read with no section is allowed (company scoping still applies).
 * - A write with no section is refused (the boot audit makes this unreachable).
 * - Otherwise the caller's effective permission in the token's company decides:
 *   `true` or a record path allows, `false` or absent refuses with 403.
 * - No administrator bypass.
 */
@Injectable()
export class ModulePermissionGate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
    private readonly permissions: ModulePermissionService,
    @Optional()
    @Inject(PERMISSIONS_ENFORCE)
    private readonly enforce?: boolean,
  ) {}

  get enabled(): boolean {
    return this.enforce === true;
  }

  async assert(params: { request: any; context: ExecutionContext }): Promise<void> {
    if (!this.enabled) return;

    const userId: string | undefined = params.request?.user?.userId;
    // No authenticated session (optional guard, anonymous caller): nothing to evaluate.
    if (!userId) return;

    const { module, action } = resolveRouteAcl({
      classDefinition: this.reflector.get<ModuleDefinition>(MODULE_ACL_METADATA, params.context.getClass()),
      handlerDefinition: this.reflector.get<ModuleDefinition>(MODULE_ACL_METADATA, params.context.getHandler()),
      method: params.request?.method,
    });

    if (!module) {
      if (action === "read") return;
      throw new ForbiddenException();
    }

    const companyId: string | undefined = (this.cls.isActive() ? this.cls.get("companyId") : undefined) ?? undefined;

    const allowed = await this.permissions.allows({ userId, companyId, moduleId: module, action });
    if (!allowed) throw new ForbiddenException();
  }
}
