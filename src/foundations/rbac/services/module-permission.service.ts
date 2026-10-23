import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { RbacPermissionRepository } from "../repositories/rbac-permission.repository";
import type { EffectivePermissions } from "../repositories/rbac-permission.repository";
import type { RbacAction } from "./rbac-permission.service";

export type { EffectivePermissions } from "../repositories/rbac-permission.repository";

/** CLS key holding the permissions resolved for the current request. */
const CLS_KEY = "effectivePermissions";

interface CachedPermissions {
  key: string;
  permissions: EffectivePermissions;
}

/**
 * Resolves a caller's effective permissions in the token's company, for the
 * request-level permission gate (`ModulePermissionGate`).
 *
 * Mirrors `RbacPermissionService` (same `featureModuleQuery` resolution) with
 * three differences: it binds the token's company instead of the legacy
 * `BELONGS_TO` edge, it keeps record-path values (a string allows at the
 * section level), and it resolves once per request (cached in CLS).
 *
 * No administrator bypass: the platform Administrator is resolved like any
 * role, so its grants must exist in the app's permission table.
 */
@Injectable()
export class ModulePermissionService {
  constructor(
    private readonly repository: RbacPermissionRepository,
    private readonly cls: ClsService,
  ) {}

  async resolve(params: { userId: string; companyId: string | undefined }): Promise<EffectivePermissions> {
    const key = `${params.userId}|${params.companyId ?? ""}`;
    const clsActive = this.cls.isActive();

    if (clsActive) {
      const cached = this.cls.get<CachedPermissions | undefined>(CLS_KEY);
      if (cached && cached.key === key) return cached.permissions;
    }

    const permissions = await this.repository.findEffectivePermissions({
      userId: params.userId,
      companyId: params.companyId || undefined,
    });

    if (clsActive) this.cls.set<CachedPermissions>(CLS_KEY, { key, permissions });

    return permissions;
  }

  /** True when the effective value is `true` or a non-empty record path. */
  async allows(params: {
    userId: string;
    companyId: string | undefined;
    moduleId: string;
    action: RbacAction;
  }): Promise<boolean> {
    const permissions = await this.resolve({ userId: params.userId, companyId: params.companyId });
    const value = permissions.get(params.moduleId)?.[params.action];
    return value === true || (typeof value === "string" && value.length > 0);
  }
}
