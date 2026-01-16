// Permission resolution logic - reusable for both regular users and administrators
// Expects: m (module), perm (HAS_PERMISSIONS relationship, can be null)
export const modulePermissionResolutionQuery = `
    WITH m,
        coalesce(apoc.convert.fromJsonList(m.permissions), []) AS defaultPermissions,
        collect(perm) AS perms
    WITH m, defaultPermissions,
        apoc.coll.flatten([p IN perms | coalesce(apoc.convert.fromJsonList(p.permissions), [])]) AS rolePerms
    WITH m,
        head([x IN defaultPermissions WHERE x.type = 'create' | x.value]) AS defaultCreate,
        head([x IN defaultPermissions WHERE x.type = 'read'   | x.value]) AS defaultRead,
        head([x IN defaultPermissions WHERE x.type = 'update' | x.value]) AS defaultUpdate,
        head([x IN defaultPermissions WHERE x.type = 'delete' | x.value]) AS defaultDelete,
        rolePerms
    WITH m,
        [defaultCreate] + [x IN rolePerms WHERE x.type = 'create' | x.value] AS createValues,
        [defaultRead]   + [x IN rolePerms WHERE x.type = 'read'   | x.value] AS readValues,
        [defaultUpdate] + [x IN rolePerms WHERE x.type = 'update' | x.value] AS updateValues,
        [defaultDelete] + [x IN rolePerms WHERE x.type = 'delete' | x.value] AS deleteValues
    WITH m,
        CASE
        WHEN any(x IN createValues WHERE x = true) THEN true
        WHEN any(x IN createValues WHERE x IS NOT NULL AND x <> false AND x <> true)
            THEN head([x IN createValues WHERE x IS NOT NULL AND x <> false AND x <> true])
        ELSE coalesce(head(createValues), false)
        END AS effectiveCreate,
        CASE
        WHEN any(x IN readValues WHERE x = true) THEN true
        WHEN any(x IN readValues WHERE x IS NOT NULL AND x <> false AND x <> true)
            THEN head([x IN readValues WHERE x IS NOT NULL AND x <> false AND x <> true])
        ELSE coalesce(head(readValues), false)
        END AS effectiveRead,
        CASE
        WHEN any(x IN updateValues WHERE x = true) THEN true
        WHEN any(x IN updateValues WHERE x IS NOT NULL AND x <> false AND x <> true)
            THEN head([x IN updateValues WHERE x IS NOT NULL AND x <> false AND x <> true])
        ELSE coalesce(head(updateValues), false)
        END AS effectiveUpdate,
        CASE
        WHEN any(x IN deleteValues WHERE x = true) THEN true
        WHEN any(x IN deleteValues WHERE x IS NOT NULL AND x <> false AND x <> true)
            THEN head([x IN deleteValues WHERE x IS NOT NULL AND x <> false AND x <> true])
        ELSE coalesce(head(deleteValues), false)
        END AS effectiveDelete
    WITH m, apoc.convert.toJson([
            { type: "create", value: effectiveCreate },
            { type: "read",   value: effectiveRead },
            { type: "update", value: effectiveUpdate },
            { type: "delete", value: effectiveDelete }
        ]) AS newPermissions
    CALL apoc.create.vNode(
    labels(m),
    apoc.map.merge(properties(m), { permissions: newPermissions })
    ) YIELD node AS module

    RETURN module
`;

// For regular users: modules via Company → Features → Modules
export const featureModuleQuery = `
    OPTIONAL MATCH (user)-[:MEMBER_OF]->(role:Role)
    OPTIONAL MATCH (feature:Feature)
      WHERE exists((company)-[:HAS_FEATURE]->(feature))
         OR feature.isCore = true
    MATCH (m:Module)-[:IN_FEATURE]->(feature)
    OPTIONAL MATCH (role)-[perm:HAS_PERMISSIONS]->(m)
    ${modulePermissionResolutionQuery}
`;

// For Administrator users: modules via Role → HAS_PERMISSIONS → Module
export const adminModuleQuery = `
    MATCH (user:User {id: $searchValue})-[:MEMBER_OF]->(role:Role)
    MATCH (role)-[perm:HAS_PERMISSIONS]->(m:Module)
    ${modulePermissionResolutionQuery}
`;
