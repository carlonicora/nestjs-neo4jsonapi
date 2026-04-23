import { Injectable, Logger } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { featureModuleQuery } from "../../../foundations/module/queries/feature.module.query";

interface PermissionEntry {
  type: string;
  value: unknown;
}

/**
 * Resolves which (Module) node IDs the current user can READ. Mirrors the
 * permission model used by the rest of the app (see AuthRepository): a module
 * is visible to the user iff its parent Feature is subscribed by the user's
 * Company (or is a core Feature), and the effective `read` permission after
 * merging the Module's default `permissions` JSON with any role-level
 * `HAS_PERMISSIONS` overrides resolves to `true`.
 *
 * Used by the chatbot to filter the graph catalog at request time.
 */
@Injectable()
export class UserModulesRepository {
  private readonly logger = new Logger(UserModulesRepository.name);

  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Returns every (Module).id the user has effective `read` access to.
   *
   * The query reuses `featureModuleQuery` — identical to the permission
   * resolution run at login by AuthRepository — so the chatbot's module
   * filter is always in lock-step with the rest of the app. The resolved
   * effective permissions are returned on a virtual module node as a JSON
   * string on `properties.permissions`; we parse it and keep the modules
   * where `read.value === true`.
   */
  async findModuleIdsForUser(userId: string): Promise<string[]> {
    const result = await this.neo4j.read(
      `
      MATCH (user:User {id: $userId})-[:BELONGS_TO]->(company:Company)
      ${featureModuleQuery}
      `,
      { userId },
    );

    const moduleIds: string[] = [];
    for (const record of result.records) {
      const moduleNode: any = record.get("module");
      const props = moduleNode?.properties;
      if (!props) continue;
      const id = props.id;
      const permsJson = props.permissions;
      if (typeof id !== "string" || !id.length || typeof permsJson !== "string") continue;
      try {
        const perms = JSON.parse(permsJson) as PermissionEntry[];
        const read = perms.find((p) => p.type === "read");
        if (read?.value === true) moduleIds.push(id);
      } catch {
        this.logger.warn(`findModuleIdsForUser: malformed permissions JSON on module ${id}`);
      }
    }
    this.logger.log(`findModuleIdsForUser: userId=${userId} readableModuleIds=${JSON.stringify(moduleIds)}`);
    return moduleIds;
  }
}
