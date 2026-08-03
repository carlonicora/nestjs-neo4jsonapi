/**
 * Canonical Cypher fragments for company-scoped role membership.
 *
 * These helpers are THE only sanctioned way to read/write role membership:
 * (user)-[:HAS_MEMBERSHIP]->(:Membership)-[:IN_COMPANY]->(company)
 * (membership)-[:HAS_ROLE]->(role)
 *
 * Rules for use:
 * - `$companyId` is auto-injected from CLS by `Neo4jService.initQuery()`. Queries
 *   that must scope to an EXPLICIT company (login, switch, migration) set
 *   `query.queryParams.companyId` after `initQuery()`.
 * - `$membershipId` is always `randomUUID()` generated in TypeScript and passed as
 *   a param — never `randomUUID()` in Cypher (keeps writes deterministic/testable).
 * - `Membership.createdAt`/`updatedAt` are always written with `datetime()` in
 *   Cypher, never as a string param.
 * - Invariant: every code path that deletes a `BELONGS_TO` edge, deletes a user, or
 *   deletes a company MUST also `DETACH DELETE` the corresponding (user, company)
 *   Membership node(s). An orphaned membership whose company vanished would read as
 *   a PLATFORM membership — a privilege escalation.
 */

/**
 * Effective-role read: roles of `userAlias` in the company bound to $companyId,
 * PLUS platform-level roles (membership with no IN_COMPANY edge).
 * Emits OPTIONAL MATCH lines; `roleAlias` is the Role node alias the caller's
 * RETURN statement expects (e.g. "user_role", "auth_user_role").
 */
export const membershipRoleMatch = (params: { userAlias: string; roleAlias: string }): string => `
  OPTIONAL MATCH (${params.userAlias})-[:HAS_MEMBERSHIP]->(${params.roleAlias}_ms:Membership)
  WHERE (${params.roleAlias}_ms)-[:IN_COMPANY]->(:Company {id: $companyId})
     OR NOT (${params.roleAlias}_ms)-[:IN_COMPANY]->(:Company)
  OPTIONAL MATCH (${params.roleAlias}_ms)-[:HAS_ROLE]->(${params.roleAlias}:Role)
`;

/**
 * Required variant (MATCH, not OPTIONAL MATCH) for queries that filter BY role,
 * with the role id bound to $roleParamName (default $roleId).
 */
export const membershipRoleMatchRequired = (params: {
  userAlias: string;
  roleAlias: string;
  roleParamName?: string;
}): string => `
  MATCH (${params.userAlias})-[:HAS_MEMBERSHIP]->(${params.roleAlias}_ms:Membership)
  WHERE (${params.roleAlias}_ms)-[:IN_COMPANY]->(:Company {id: $companyId})
     OR NOT (${params.roleAlias}_ms)-[:IN_COMPANY]->(:Company)
  MATCH (${params.roleAlias}_ms)-[:HAS_ROLE]->(${params.roleAlias}:Role {id: $${params.roleParamName ?? "roleId"}})
`;

/**
 * Write: ensure the (user, company) membership exists and grant roles.
 * Expects $membershipId (fresh uuid) and $roleIds (string[]) params;
 * `userAlias` and `companyAlias` must already be bound.
 *
 * The OPTIONAL MATCH + FOREACH shape deliberately avoids
 * `MERGE (ms)-[:HAS_ROLE]->(:Role {id: roleId})`, which would CREATE a phantom
 * Role node when the id does not exist (FOREACH cannot contain MATCH).
 */
export const grantCompanyRoles = (params: { userAlias: string; companyAlias: string }): string => `
  MERGE (${params.userAlias})-[:HAS_MEMBERSHIP]->(ms:Membership)-[:IN_COMPANY]->(${params.companyAlias})
  ON CREATE SET ms.id = $membershipId, ms.createdAt = datetime(), ms.updatedAt = datetime()
  SET ms.updatedAt = datetime()
  WITH ms
  UNWIND CASE WHEN size($roleIds) = 0 THEN [null] ELSE $roleIds END AS roleId
  OPTIONAL MATCH (grant_role:Role {id: roleId})
  FOREACH (_ IN CASE WHEN grant_role IS NULL THEN [] ELSE [1] END |
    MERGE (ms)-[:HAS_ROLE]->(grant_role)
  )
`;

/**
 * Write: ensure the user's PLATFORM membership (no IN_COMPANY) exists and grant
 * the role bound to $roleId. Expects $membershipId. `userAlias` must be bound.
 */
export const grantPlatformRole = (params: { userAlias: string }): string => `
  OPTIONAL MATCH (${params.userAlias})-[:HAS_MEMBERSHIP]->(existing_ms:Membership)
  WHERE NOT (existing_ms)-[:IN_COMPANY]->(:Company)
  FOREACH (_ IN CASE WHEN existing_ms IS NULL THEN [1] ELSE [] END |
    CREATE (${params.userAlias})-[:HAS_MEMBERSHIP]->(:Membership {id: $membershipId, createdAt: datetime(), updatedAt: datetime()})
  )
  WITH ${params.userAlias}
  MATCH (${params.userAlias})-[:HAS_MEMBERSHIP]->(platform_ms:Membership)
  WHERE NOT (platform_ms)-[:IN_COMPANY]->(:Company)
  MATCH (platform_role:Role {id: $roleId})
  MERGE (platform_ms)-[:HAS_ROLE]->(platform_role)
`;
