/**
 * JSON Schema Interfaces
 *
 * Type definitions for the JSON module definition files
 * located in the /structure folder.
 */

/**
 * Field definition in JSON schema
 */
export interface JsonFieldDefinition {
  name: string;
  type: string;
  nullable: boolean;
}

/**
 * Relationship definition in JSON schema
 */
export interface JsonRelationshipDefinition {
  name: string;
  variant?: string;
  directory: string;
  single: boolean;
  relationshipName: string;
  toNode: boolean;
  nullable: boolean;
  /** Fields stored on the relationship (edge properties). Only supported when single: true */
  fields?: JsonFieldDefinition[];
  /** If true, relationship is set only on creation and skipped during PUT (default: false) */
  immutable?: boolean;
}

/**
 * Complete module definition from JSON
 */
export interface JsonModuleDefinition {
  moduleId: string;
  moduleName: string;
  endpointName: string;
  targetDir: string;
  languages: string[];
  fields: JsonFieldDefinition[];
  relationships: JsonRelationshipDefinition[];
}
