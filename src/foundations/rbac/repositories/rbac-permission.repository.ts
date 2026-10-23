import { Injectable, Logger } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { Module } from "../../module/entities/module.entity";
import { ModuleModel } from "../../module/entities/module.model";
import { adminModuleQuery, featureModuleQuery } from "../../module/queries/feature.module.query";
import type { RbacAction } from "../services/rbac-permission.service";

interface PermissionEntry {
  type: string;
  value: unknown;
}

/**
 * Effective permission values per module id. A value is `true`, `false` or a
 * record path (a non-empty string such as `"id"`), exactly as resolved by
 * `modulePermissionResolutionQuery`.
 */
export type EffectivePermissions = Map<string, Record<RbacAction, boolean | string>>;

/**
 * Resolves the effective per-module permission flags for a user. Mirrors the
 * permission model used by the rest of the app (see AuthRepository and
 * UserModulesRepository): a module is visible to the user iff its parent
 * Feature is subscribed by the user's Company (or is a core Feature), and the
 * effective permissions result from merging the Module's default
 * `permissions` JSON with any role-level `HAS_PERMISSIONS` overrides.
 *
 * Used by RbacPermissionService to answer `can(userId, moduleId, action)`
 * for the MCP layer, and by ModulePermissionService for the request gate.
 */
@Injectable()
export class RbacPermissionRepository {
  private readonly logger = new Logger(RbacPermissionRepository.name);

  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Effective per-module permission flags for a user.
   *
   * The query reuses `featureModuleQuery` — identical to the permission
   * resolution run at login by AuthRepository and by the chatbot's
   * UserModulesRepository — so MCP permission checks are always in
   * lock-step with the rest of the app. The resolved effective permissions
   * are returned on a virtual module node as a JSON string on
   * `properties.permissions`; we parse it and keep all four permission
   * types (`read`, `create`, `update`, `delete`).
   */
  async findEffectivePermissionsForUser(userId: string): Promise<Map<string, Record<RbacAction, boolean>>> {
    const result = await this.neo4j.read(
      `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company:Company)
      ${featureModuleQuery}
      `,
      { userId },
    );

    const map = new Map<string, Record<RbacAction, boolean>>();
    for (const record of result.records) {
      const moduleNode: any = record.get("module");
      const props = moduleNode?.properties;
      if (!props) continue;
      const id = props.id;
      const permsJson = props.permissions;
      if (typeof id !== "string" || !id.length || typeof permsJson !== "string") continue;
      try {
        const perms = JSON.parse(permsJson) as PermissionEntry[];
        map.set(id, {
          read: perms.find((p) => p.type === "read")?.value === true,
          create: perms.find((p) => p.type === "create")?.value === true,
          update: perms.find((p) => p.type === "update")?.value === true,
          delete: perms.find((p) => p.type === "delete")?.value === true,
        });
      } catch {
        this.logger.warn(`findEffectivePermissionsForUser: malformed permissions JSON on module ${id}`);
      }
    }
    return map;
  }

  /**
   * Effective permissions of a user in ONE company: the module defaults plus
   * the grants of the roles on the user's membership in that company and on
   * the user's platform memberships (no `IN_COMPANY`). Never follows the
   * legacy `(User)-[:BELONGS_TO]->(Company)` edge.
   *
   * With no `companyId` (a platform session) it resolves through the
   * platform membership only (`adminModuleQuery`).
   *
   * Record-path values are kept as strings: the request gate allows them at
   * the section level and leaves the record decision to the app.
   *
   * Intentional exception to "use buildDefaultMatch": this is the library's
   * own permission resolution (the same `company` binding UserModulesRepository
   * uses), not an entity read.
   */
  async findEffectivePermissions(params: {
    userId: string;
    companyId: string | undefined;
  }): Promise<EffectivePermissions> {
    const result = params.companyId
      ? await this.neo4j.read(
          `
          MATCH (user:User {id: $userId})
          MATCH (company:Company {id: $companyId})
          ${featureModuleQuery}
          `,
          { userId: params.userId, companyId: params.companyId },
        )
      : await this.neo4j.read(adminModuleQuery, { searchValue: params.userId });

    const map: EffectivePermissions = new Map();
    for (const record of result.records) {
      const moduleNode: any = record.get("module");
      const props = moduleNode?.properties;
      if (!props) continue;
      const id = props.id;
      const permsJson = props.permissions;
      if (typeof id !== "string" || !id.length || typeof permsJson !== "string") continue;
      try {
        const perms = JSON.parse(permsJson) as PermissionEntry[];
        const value = (type: RbacAction): boolean | string => {
          const raw = perms.find((p) => p.type === type)?.value;
          if (raw === true) return true;
          if (typeof raw === "string" && raw.length > 0) return raw;
          return false;
        };
        map.set(id, {
          read: value("read"),
          create: value("create"),
          update: value("update"),
          delete: value("delete"),
        });
      } catch {
        this.logger.warn(`findEffectivePermissions: malformed permissions JSON on module ${id}`);
      }
    }
    return map;
  }

  /** The subset of `ids` that exist as `(:Module)` nodes. */
  async findExistingModuleIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();

    const query = this.neo4j.initQuery({ serialiser: ModuleModel });
    query.queryParams = { ...query.queryParams, ids };
    query.query += `
      MATCH (module:Module)
      WHERE module.id IN $ids
      RETURN module
    `;

    const modules = await this.neo4j.readMany<Module>(query);
    return new Set<string>(modules.map((module) => module.id));
  }
}
