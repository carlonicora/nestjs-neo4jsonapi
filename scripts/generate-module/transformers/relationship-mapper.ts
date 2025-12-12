import { JsonRelationshipDefinition } from "../types/json-schema.interface";
import { DescriptorRelationship } from "../types/template-data.interface";
import { toCamelCase, pluralize, transformNames } from "./name-transformer";

/**
 * Map JSON relationship definition to descriptor relationship
 *
 * Key mappings:
 * - toNode: true → direction: "in" (relationship TO this entity)
 * - toNode: false → direction: "out" (relationship FROM this entity)
 * - single: true → cardinality: "one"
 * - single: false → cardinality: "many"
 * - variant: "Author" → contextKey: "userId"
 * - variant: other → dtoKey: pluralized variant
 *
 * @param rel - JSON relationship definition
 * @returns Descriptor relationship configuration
 */
export function mapRelationship(rel: JsonRelationshipDefinition): DescriptorRelationship {
  // Core mappings
  const direction = rel.toNode ? "in" : "out";
  const cardinality = rel.single ? "one" : "many";

  // Determine contextKey and dtoKey based on variant
  let contextKey: string | undefined;
  let dtoKey: string | undefined;

  if (rel.variant === "Author") {
    // Special case: Author variant uses contextKey
    contextKey = "userId";
  } else if (rel.variant) {
    // Other variants: use variant name as dtoKey (pluralized)
    dtoKey = pluralize(rel.variant.toLowerCase());
  } else {
    // No variant: use entity name as dtoKey (pluralized)
    dtoKey = pluralize(rel.name.toLowerCase());
  }

  // Determine relationship key (what it's called in the descriptor)
  const key = toCamelCase(rel.variant || rel.name);

  // Meta import name (e.g., "userMeta", "discussionMeta")
  const model = `${toCamelCase(rel.name)}Meta`;

  // Related entity name transformations
  const relatedEntityNames = transformNames(rel.name, pluralize(rel.name.toLowerCase()));

  return {
    key,
    model,
    direction,
    relationship: rel.relationshipName,
    cardinality,
    contextKey,
    dtoKey,
    nullable: rel.nullable,
    relatedEntity: {
      name: rel.name,
      directory: rel.directory,
      pascalCase: relatedEntityNames.pascalCase,
      camelCase: relatedEntityNames.camelCase,
      kebabCase: relatedEntityNames.kebabCase,
    },
  };
}

/**
 * Map multiple relationships and handle deduplication
 *
 * @param relationships - Array of JSON relationship definitions
 * @returns Array of descriptor relationships
 */
export function mapRelationships(relationships: JsonRelationshipDefinition[]): DescriptorRelationship[] {
  return relationships.map(mapRelationship);
}

/**
 * Get unique meta imports from relationships
 * Handles cases where multiple relationships reference the same entity
 *
 * @param relationships - Array of descriptor relationships
 * @returns Deduplicated list of meta import names
 */
export function getUniqueMetaImports(relationships: DescriptorRelationship[]): string[] {
  const metaSet = new Set(relationships.map((rel) => rel.model));
  return Array.from(metaSet).sort();
}

/**
 * Get unique entity imports from relationships
 *
 * @param relationships - Array of descriptor relationships
 * @returns Deduplicated list of entity names
 */
export function getUniqueEntityImports(relationships: DescriptorRelationship[]): string[] {
  const entitySet = new Set(relationships.map((rel) => rel.relatedEntity.name));
  return Array.from(entitySet).sort();
}
