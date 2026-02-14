import { Type } from "@nestjs/common";
import { DataMeta, DataModelInterface } from "./datamodel.interface";

/**
 * Neo4j/Cypher base data types for field definitions (scalar)
 */
export type CypherBaseType = "string" | "number" | "boolean" | "date" | "datetime" | "json";

/**
 * Neo4j/Cypher array data types for field definitions
 */
export type CypherArrayType = "string[]" | "number[]" | "boolean[]" | "date[]" | "datetime[]" | "json[]";

/**
 * All supported Neo4j/Cypher data types (scalar and array)
 */
export type CypherType = CypherBaseType | CypherArrayType;

/**
 * Transformer function for field serialisation
 * Receives the entity data and any injected services
 */
export type FieldTransformFn = (data: any, services: Record<string, any>) => Promise<any> | any;

/**
 * Field definition for entity schema
 * Defines a single property with its type and constraints
 */
export interface FieldDef {
  /** Neo4j/Cypher data type */
  type: CypherType;
  /** Whether the field is required (default: false) */
  required?: boolean;
  /** Default value to use when creating an entity */
  default?: any;
  /** If true, field goes to JSON:API meta instead of attributes (default: false) */
  meta?: boolean;
  /** Async transformer function for serialisation - receives data and injected services */
  transform?: FieldTransformFn;
  /** If true, field is excluded from JSONAPI serialization entirely (default: false) */
  excludeFromJsonApi?: boolean;
}

/**
 * Function signature for computed field calculation
 * @param params.data - The raw Neo4j node data
 * @param params.record - The full Neo4j record (for accessing related data like totalScore)
 * @param params.entityFactory - EntityFactory instance for creating related entities
 * @param params.name - Optional name for the entity in the record
 */
export type ComputedFieldFn<T = any> = (params: { data: any; record: any; entityFactory: any; name?: string }) => T;

/**
 * Computed field definition for runtime-calculated values
 * These fields don't exist in Neo4j but are calculated from record data
 */
export interface ComputedFieldDef<T = any> {
  /** Function to compute the field value */
  compute: ComputedFieldFn<T>;
  /** If true, field goes to JSON:API meta instead of attributes (default: false) */
  meta?: boolean;
  /** If true, field is excluded from JSONAPI serialization entirely (default: false) */
  excludeFromJsonApi?: boolean;
}

/**
 * Virtual field definition for output-only computed values.
 * Unlike computed fields, virtual fields can have arbitrary names that
 * don't exist in the entity type. They appear in JSON:API attributes by default.
 *
 * Example: avatarUrl returns the raw S3 key while avatar returns the signed URL.
 */
export interface VirtualFieldDef {
  /** Function to compute the field value */
  compute: ComputedFieldFn<any>;
  /** If true, field goes to JSON:API meta instead of attributes (default: false) */
  meta?: boolean;
  /** If true, field is excluded from JSONAPI serialization entirely (default: false) */
  excludeFromJsonApi?: boolean;
}

/**
 * Field definition for relationship properties
 * These are stored on the Neo4j relationship (edge), not on nodes
 */
export interface RelationshipFieldDef {
  /** Field name */
  name: string;
  /** Neo4j/Cypher data type */
  type: CypherType;
  /** Whether the field is required (default: false) */
  required?: boolean;
  /** Default value */
  default?: any;
}

/**
 * Relationship definition for entity schema
 * Defines how this entity relates to another entity
 */
export interface RelationshipDef {
  /** Metadata of the related entity */
  model: DataMeta;
  /** Direction: 'in' = (related)-[:REL]->(this), 'out' = (this)-[:REL]->(related) */
  direction: "in" | "out";
  /** Neo4j relationship type (e.g., "PUBLISHED", "RELEVANT_FOR") */
  relationship: string;
  /** Cardinality: 'one' for single, 'many' for collection */
  cardinality: "one" | "many";
  /** Whether the relationship is required. If false, uses OPTIONAL MATCH in queries */
  required?: boolean;
  /** Context key for relationships whose value comes from CLS context (e.g., 'userId' for author) */
  contextKey?: string;
  /** DTO key override for the relationships object (e.g., 'topics' instead of relationship key 'topic') */
  dtoKey?: string;
  /** Fields stored on the relationship (edge properties). Only supported for cardinality: 'one' */
  fields?: RelationshipFieldDef[];
  /** For polymorphic relationships - multiple possible types for same Neo4j label */
  polymorphic?: PolymorphicConfig;
  /** If true, relationship is set only on creation and skipped during PUT (default: false) */
  immutable?: boolean;
}

/**
 * Data available to polymorphic discriminator function
 */
export interface PolymorphicDiscriminatorData {
  /** Entity properties from Neo4j */
  properties: Record<string, any>;
  /** Neo4j labels on the node */
  labels: string[];
  /** Whether node has outgoing SPECIALISES relationship (for taxonomy case) */
  hasParent?: boolean;
}

/**
 * Configuration for polymorphic relationships where multiple entity types
 * share the same Neo4j label but have different JSON:API types
 */
export interface PolymorphicConfig {
  /** List of candidate models that could match this relationship */
  candidates: DataMeta[];
  /** Function that determines the correct model based on node data */
  discriminator: (data: PolymorphicDiscriminatorData) => DataMeta;
  /** Relationship type to check for discriminator (e.g., "SPECIALISES") */
  discriminatorRelationship?: string;
  /** Direction of discriminator relationship check: "out" = node has outgoing */
  discriminatorDirection?: "in" | "out";
  /** When true, also fetch the target of discriminatorRelationship for inclusion */
  includeDiscriminatorTarget?: boolean;
  /** Property name to assign the discriminator target to (e.g., "taxonomy" for LeafTaxonomy's parent) */
  discriminatorTargetProperty?: string;
}

/**
 * Input schema for defineEntity function
 * This is the clean, declarative API for defining entities
 *
 * @template T - The entity type (e.g., Glossary)
 * @template R - The relationships record type for autocomplete support
 */
export interface EntitySchemaInput<T, R extends Record<string, RelationshipDef> = Record<string, RelationshipDef>> {
  // === Meta properties (replaces entity.meta.ts) ===

  /** JSON:API type (e.g., "glossaries") */
  type: string;
  /** API endpoint path (e.g., "glossaries") */
  endpoint: string;
  /** Neo4j node name/alias used in Cypher queries (e.g., "glossary") */
  nodeName: string;
  /** Neo4j label name (e.g., "Glossary") */
  labelName: string;

  // === Schema configuration ===

  /** Whether this entity belongs to a company (default: true). Set to false for generic/global entities. */
  isCompanyScoped?: boolean;
  /** Field definitions - keys must be valid entity properties */
  fields: { [K in keyof Partial<T>]?: FieldDef };
  /** Relationship definitions with named keys for autocomplete */
  relationships: R;
  /** Computed fields - calculated at runtime from Neo4j record data. Keys must be valid entity properties. */
  computed?: { [K in keyof Partial<T>]?: ComputedFieldDef };

  /** Virtual fields - output-only computed values with arbitrary names (e.g., avatarUrl).
   *  Unlike computed fields, virtual field keys don't need to exist in the entity type. */
  virtualFields?: Record<string, VirtualFieldDef>;

  // === Optional overrides ===

  /** Custom serializer class (only needed for special transformations like S3 URL signing) */
  serialiser?: new (...args: any[]) => any;

  /** Services to inject into auto-generated serialiser for field transformers */
  injectServices?: Type<any>[];
}

/**
 * Computed entity descriptor - output of defineEntity()
 * Contains both the original schema and computed/derived values
 *
 * @template T - The entity type
 * @template R - The relationships record type for autocomplete support
 */
export interface EntityDescriptor<T, R extends Record<string, RelationshipDef> = Record<string, RelationshipDef>> {
  /** The data model interface (auto-generated with mapper, childrenTokens, etc.) */
  model: DataModelInterface<T>;

  /** Whether this entity belongs to a company. False for generic/global entities. */
  isCompanyScoped: boolean;

  /** Named relationships with autocomplete support (e.g., descriptor.relationships.author) */
  relationships: R;

  /** Relationship keys for autocomplete (e.g., descriptor.relationshipKeys.author returns "author") */
  relationshipKeys: { [K in keyof R]: K };

  // === Computed from fields ===

  /** All field names (keys of fields) */
  fieldNames: string[];

  /** Fields with type: 'string' - used for FULLTEXT index */
  stringFields: string[];

  /** Fields with required: true */
  requiredFields: string[];

  /** Default values extracted from field definitions */
  fieldDefaults: Record<string, any>;

  /** Field definitions map for type lookup */
  fields: { [K in keyof Partial<T>]?: FieldDef };

  /** Computed field definitions */
  computed: { [K in keyof Partial<T>]?: ComputedFieldDef };

  /** Virtual field definitions - output-only computed values with arbitrary names */
  virtualFields: Record<string, VirtualFieldDef>;

  /** Services to inject into auto-generated serialiser for field transformers */
  injectServices: Type<any>[];

  // === Auto-generated database config ===

  /** Always: [{ property: 'id', type: 'UNIQUE' }] */
  constraints: Array<{ property: string; type: "UNIQUE" | "EXISTS" | "NODE_KEY" }>;

  /** Auto-generated FULLTEXT index from string fields */
  indexes: Array<{ name: string; properties: string[]; type: "FULLTEXT" | "BTREE" | "TEXT" }>;

  /** Auto-generated index name: {nodeName}_search_index */
  fulltextIndexName: string;

  /** Default ordering for queries */
  defaultOrderBy: string;
}
