import { PermissionMapping } from "./permission-mapping.entity";

/**
 * Maps raw query results into a PermissionMapping entity.
 * Unlike standard entities (which come from Neo4j nodes), PermissionMappings
 * represent HAS_PERMISSIONS relationship edges between Role and Module nodes.
 * The repository constructs these objects directly from query results.
 */
export const mapPermissionMappingFromRow = (row: {
  roleId: string;
  moduleId: string;
  permissions: string | null;
}): PermissionMapping => {
  const rawPermissions = JSON.parse(row.permissions ?? "[]");

  const permissions: PermissionMapping["permissions"] = {};
  for (const singlePermission of rawPermissions) {
    permissions[singlePermission["type"] as keyof PermissionMapping["permissions"]] = singlePermission["value"];
  }

  return {
    id: `${row.roleId}:${row.moduleId}`,
    type: "permission-mappings",
    createdAt: new Date(),
    updatedAt: new Date(),
    roleId: row.roleId,
    moduleId: row.moduleId,
    permissions,
  };
};
