// NEURAL-238: Audit Log Migration — Audit -> AuditLog
// Run with: cat packages/nestjs-neo4jsonapi/migrations/audit-log-migration.cypher | cypher-shell -u neo4j -p <password>
// All operations are batched for safe execution on large datasets.

// Step 1: Rename labels
CALL {
  MATCH (a:Audit)
  SET a:AuditLog
  REMOVE a:Audit
} IN TRANSACTIONS OF 1000 ROWS;

// Step 2: Rename relationships
CALL {
  MATCH (u:User)-[r:INITIATED]->(a:AuditLog)
  CREATE (u)-[:PERFORMED]->(a)
  DELETE r
} IN TRANSACTIONS OF 1000 ROWS;

// Step 3: Backfill entity_type/entity_id from [:AUDITED] relationship
CALL {
  MATCH (a:AuditLog)-[:AUDITED]->(entity)
  WITH a, entity,
       [l IN labels(entity) WHERE NOT l IN ['AuditLog', 'Company', 'User']] AS entityLabels
  SET a.entity_type = CASE WHEN size(entityLabels) > 0 THEN entityLabels[0] ELSE head(labels(entity)) END,
      a.entity_id = entity.id,
      a.field_name = null,
      a.old_value = a.changes,
      a.new_value = null,
      a.ip_address = null
  REMOVE a.changes
} IN TRANSACTIONS OF 1000 ROWS;

// Step 4: Backfill company_id from audited entity's company relationship
CALL {
  MATCH (a:AuditLog)-[:AUDITED]->(entity)-[:BELONGS_TO]->(company:Company)
  SET a.company_id = company.id
} IN TRANSACTIONS OF 1000 ROWS;

// Step 5: Map old auditType to new action
CALL {
  MATCH (a:AuditLog)
  WHERE a.auditType IS NOT NULL
  SET a.action = CASE a.auditType
    WHEN "read" THEN "read"
    WHEN "create" THEN "create"
    WHEN "edit" THEN "update"
    ELSE a.auditType
  END
  REMOVE a.auditType
} IN TRANSACTIONS OF 1000 ROWS;
