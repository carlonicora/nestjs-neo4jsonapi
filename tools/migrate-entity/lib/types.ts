/**
 * Entity Migration CLI - Shared Types
 *
 * Types used across the migration tool modules.
 */

export interface MigratorOptions {
  path?: string;
  entity?: string;
  all?: boolean;
  dryRun?: boolean;
  skipBackup?: boolean;
  verbose?: boolean;
}

export interface OldEntityFiles {
  entityName: string;
  entityDir: string;
  entity: string | null;
  meta: string;
  model: string | null;
  map: string | null;
  serialiser: string | null;
}

export interface ParsedMeta {
  type: string;
  endpoint: string;
  nodeName: string;
  labelName: string;
}

/**
 * Information about an alias model (e.g., OwnerModel, AuthorModel)
 * that shares the same entity type but has different meta.
 */
export interface AliasModelInfo {
  /** The exported model name (e.g., "OwnerModel") */
  modelName: string;
  /** The meta variable it spreads (e.g., "ownerMeta") */
  metaName: string;
  /** The derived descriptor name (e.g., "OwnerDescriptor") */
  descriptorName: string;
}

export interface ParsedField {
  name: string;
  type: string;
  optional: boolean;
}

export interface ParsedEntityType {
  name: string;
  fields: ParsedField[];
  relationshipFields: ParsedField[]; // Relationship fields (Company, User[], etc.)
  imports: string[];
}

export interface ParsedMapperField {
  name: string;
  mapping: string;
  isComputed: boolean;
}

export interface ParsedMapper {
  fields: ParsedMapperField[];
  imports: string[];
}

export interface ParsedSerialiserAttribute {
  name: string;
  mapping: string;
  isMeta: boolean;
}

export interface ParsedSerialiserRelationship {
  name: string;
  dtoKey?: string;
  modelImport: string;
}

/**
 * Detected S3 transform for a field
 */
export interface S3TransformInfo {
  /** Field name to apply transform to */
  fieldName: string;
  /** Whether it's an array of URLs or single URL */
  isArray: boolean;
}

export interface ParsedSerialiser {
  attributes: ParsedSerialiserAttribute[];
  meta: ParsedSerialiserAttribute[];
  relationships: ParsedSerialiserRelationship[];
  imports: string[];
  /** Injected services detected from constructor (e.g., S3Service) */
  services: string[];
  /** Custom methods that may contain transform logic */
  customMethods: string[];
  /** Detected S3 transforms for URL fields */
  s3Transforms: S3TransformInfo[];
}

export interface ParsedEntity {
  meta: ParsedMeta;
  entityType: ParsedEntityType;
  mapper: ParsedMapper | null;
  serialiser: ParsedSerialiser | null;
  /** Alias models parsed from model file (e.g., OwnerModel, AuthorModel) */
  aliasModels: AliasModelInfo[];
}

export interface FieldConfig {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  meta: boolean;
  /** Transform function code (for S3 URL signing, etc.) */
  transform?: string;
}

export interface ComputedConfig {
  name: string;
  compute: string;
  meta: boolean;
}

export interface RelationshipConfig {
  name: string;
  model: string;
  direction: "in" | "out";
  relationship: string;
  cardinality: "one" | "many";
  dtoKey?: string;
  contextKey?: string;
  /** Whether relationship is required (true) or optional (false for OPTIONAL MATCH) */
  required?: boolean;
  /** Edge properties stored on the relationship */
  fields?: RelationshipFieldConfig[];
}

export interface RelationshipFieldConfig {
  name: string;
  type: string;
  required?: boolean;
}

export interface GeneratedDescriptor {
  code: string;
  imports: string[];
}

export interface Reference {
  filePath: string;
  oldImport: string;
  newImport: string;
  usages: ReferenceUsage[];
}

export interface ReferenceUsage {
  line: number;
  oldText: string;
  newText: string;
}

export interface FileChange {
  type: "create" | "update" | "delete";
  path: string;
  content?: string;
  backup?: string;
}

export interface EntityMigrationResult {
  entityName: string;
  success: boolean;
  error?: string;
  changes: FileChange[];
}

export interface MigrationResult {
  results: EntityMigrationResult[];
  totalEntities: number;
  successCount: number;
  failureCount: number;
}

/**
 * Relationship extracted from Cypher queries in repository/cypher.service
 */
export interface CypherRelationship {
  /** Property name derived from alias (e.g., "user", "topic", "author") */
  name: string;
  /** Neo4j relationship type (e.g., "EDITED", "HAS_KNOWLEDGE", "PUBLISHED") */
  relationshipType: string;
  /** Direction: "in" for <-[:REL]-, "out" for -[:REL]-> */
  direction: "in" | "out";
  /** Related node label (e.g., "User", "Topic") */
  relatedLabel: string;
}

/**
 * Warning about custom logic in cypher.service.ts that needs manual migration
 */
export interface CypherServiceWarning {
  /** Path to the cypher.service.ts file */
  filePath: string;
  /** Type of custom logic detected */
  type: "returnStatementParams" | "userHasAccessParams" | "customMethod";
  /** Description of what was found */
  description: string;
  /** Suggested action for the LLM in Phase 2 */
  action: string;
}
