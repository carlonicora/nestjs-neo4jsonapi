import { Injectable, Inject, Optional } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { PermissionMapping } from "../entities/permission-mapping.entity";
import { ModuleRelationshipPaths } from "../entities/module-paths.entity";
import { mapPermissionMappingFromRow } from "../entities/permission-mapping.map";
import { mapModulePathsFromRow } from "../entities/module-paths.map";
import { MODULE_USER_PATHS_TOKEN } from "../rbac.constants";
import { SystemRoles } from "../../../common/constants/system.roles";

@Injectable()
export class RbacRepository {
  constructor(
    private readonly neo4j: Neo4jService,
    @Optional()
    @Inject(MODULE_USER_PATHS_TOKEN)
    private readonly moduleUserPaths: Record<string, string[]> = {},
  ) {}

  async findPermissionMappings(): Promise<PermissionMapping[]> {
    const result = await this.neo4j.read(
      `
      MATCH (role:Role)-[perm:HAS_PERMISSIONS]->(module:Module)
      WHERE role.id <> $administratorRoleId
      RETURN
        role.id AS roleId,
        module.id AS moduleId,
        perm.permissions AS permissions
      ORDER BY role.name ASC, module.name ASC
      `,
      { administratorRoleId: SystemRoles.Administrator },
    );

    return result.records.map((record: any) =>
      mapPermissionMappingFromRow({
        roleId: record.get("roleId"),
        moduleId: record.get("moduleId"),
        permissions: record.get("permissions"),
      }),
    );
  }

  async findModuleRelationshipPaths(): Promise<ModuleRelationshipPaths[]> {
    const result = await this.neo4j.read(
      `
      MATCH (m:Module)
      RETURN m.id AS moduleId, m.name AS moduleName
      `,
      {},
    );

    return result.records.map((record: any) => {
      const moduleId: string = record.get("moduleId");
      const moduleName: string = (record.get("moduleName") ?? "").toLowerCase().replace(/\s+/g, "");
      const paths = this.moduleUserPaths[moduleName] ?? [];
      return mapModulePathsFromRow({ moduleId, paths });
    });
  }
}
