import { Injectable } from "@nestjs/common";
import { RbacPermissionRepository } from "../repositories/rbac-permission.repository";

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
 */
@Injectable()
export class RbacPermissionService {
  constructor(private readonly repository: RbacPermissionRepository) {}

  /**
   * True iff the user's effective permission flag for `action` on the module
   * resolves to `true`. Unknown modules (not in the user's effective set)
   * always deny.
   */
  async can(params: { userId: string; moduleId: string; action: RbacAction }): Promise<boolean> {
    const perms = await this.repository.findEffectivePermissionsForUser(params.userId);
    return perms.get(params.moduleId)?.[params.action] === true;
  }
}
