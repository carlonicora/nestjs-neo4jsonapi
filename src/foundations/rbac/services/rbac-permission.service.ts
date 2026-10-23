import { Inject, Injectable, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { RbacPermissionRepository } from "../repositories/rbac-permission.repository";
import { PERMISSIONS_ENFORCE } from "../rbac.tokens";
import { ModulePermissionService } from "./module-permission.service";

/**
 * The four permission flags resolved per module by the RBAC permission model.
 *
 * String-literal union (not the `Action` enum from `common/enums/action.ts`)
 * so it can be re-exported from the library root without a name collision —
 * same reasoning as the rbac DSL's non-exported `Action` type.
 */
export type RbacAction = "read" | "create" | "update" | "delete";

/**
 * Answers `can(userId, moduleId, action)` using the same `featureModuleQuery`
 * permission resolution as the rest of the app (AuthRepository at login,
 * UserModulesRepository for the chatbot catalog).
 *
 * Consumed by the MCP layer to gate reads and writes per tool call.
 *
 * With `permissions.enforce` on, it delegates to `ModulePermissionService`
 * (token company from CLS, record paths allow) so tool calls and HTTP routes
 * never disagree. With it off, it behaves exactly as before.
 */
@Injectable()
export class RbacPermissionService {
  constructor(
    private readonly repository: RbacPermissionRepository,
    @Optional() @Inject(ModulePermissionService) private readonly modulePermissions?: ModulePermissionService,
    @Optional() @Inject(ClsService) private readonly cls?: ClsService,
    @Optional() @Inject(PERMISSIONS_ENFORCE) private readonly enforce?: boolean,
  ) {}

  /**
   * True iff the user's effective permission flag for `action` on the module
   * resolves to `true`. Unknown modules (not in the user's effective set)
   * always deny.
   */
  async can(params: { userId: string; moduleId: string; action: RbacAction }): Promise<boolean> {
    if (this.enforce === true && this.modulePermissions) {
      const companyId: string | undefined = this.cls?.isActive() ? (this.cls.get("companyId") ?? undefined) : undefined;
      return this.modulePermissions.allows({
        userId: params.userId,
        companyId,
        moduleId: params.moduleId,
        action: params.action,
      });
    }

    const perms = await this.repository.findEffectivePermissionsForUser(params.userId);
    return perms.get(params.moduleId)?.[params.action] === true;
  }
}
