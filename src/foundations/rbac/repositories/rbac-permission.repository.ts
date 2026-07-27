import { Injectable, Logger } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { featureModuleQuery } from "../../module/queries/feature.module.query";
import type { RbacAction } from "../services/rbac-permission.service";

interface PermissionEntry {
  type: string;
  value: unknown;
}

/**
 * Resolves the effective per-module permission flags for a user. Mirrors the
 * permission model used by the rest of the app (see AuthRepository and
 * UserModulesRepository): a module is visible to the user iff its parent
 * Feature is subscribed by the user's Company (or is a core Feature), and the
 * effective permissions result from merging the Module's default
 * `permissions` JSON with any role-level `HAS_PERMISSIONS` overrides.
 *
 * Used by RbacPermissionService to answer `can(userId, moduleId, action)`
 * for the MCP layer.
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
}
