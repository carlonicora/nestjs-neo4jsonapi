import { Injectable, Logger } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";

/**
 * Resolves which ERP modules a user's role set has permissions on.
 * Used by the ChatbotController to filter the graph catalog at request time.
 */
@Injectable()
export class UserModulesRepository {
  private readonly logger = new Logger(UserModulesRepository.name);

  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Returns the distinct `(Module) {id}` UUIDs any of the given roles has a
   * HAS_PERMISSIONS edge to. Matches the stable UUID rather than the name so
   * the catalog doesn't couple to the host app's module naming conventions.
   */
  async findModuleIdsForRoles(roleIds: string[]): Promise<string[]> {
    if (!roleIds.length) {
      this.logger.log(`findModuleIdsForRoles: no roles — returning empty module-id list`);
      return [];
    }
    const result = await this.neo4j.read(
      `MATCH (role:Role)-[:HAS_PERMISSIONS]->(m:Module)
       WHERE role.id IN $roleIds
       RETURN DISTINCT m.id AS moduleId`,
      { roleIds },
    );
    const moduleIds: string[] = result.records
      .map((r: any) => r.get("moduleId"))
      .filter((s: string | null) => typeof s === "string" && s.length > 0);
    this.logger.log(
      `findModuleIdsForRoles: roles=${roleIds.length}, moduleIds=${JSON.stringify(moduleIds)}`,
    );
    return moduleIds;
  }
}
