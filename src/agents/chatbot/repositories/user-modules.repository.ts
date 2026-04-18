import { Injectable } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";

/**
 * Resolves which ERP modules a user's role set has permissions on.
 * Used by the ChatbotController to filter the graph catalog at request time.
 */
@Injectable()
export class UserModulesRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Returns the distinct module names any of the given roles has a HAS_PERMISSIONS edge to.
   * Names are lowercased and whitespace-stripped to match the module identifiers that feature
   * modules register with `GraphDescriptorRegistry.register({ descriptor, module })`.
   */
  async findModulesForRoles(roleIds: string[]): Promise<string[]> {
    if (!roleIds.length) return [];
    const result = await this.neo4j.read(
      `MATCH (role:Role)-[:HAS_PERMISSIONS]->(m:Module)
       WHERE role.id IN $roleIds
       RETURN DISTINCT m.name AS moduleName`,
      { roleIds },
    );
    return result.records
      .map((r: any) => r.get("moduleName"))
      .filter((s: string | null) => typeof s === "string" && s.length > 0)
      .map((s: string) => s.toLowerCase().replace(/\s+/g, ""));
  }
}
