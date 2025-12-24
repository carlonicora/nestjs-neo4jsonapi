import { JsonRelationshipDefinition } from "../types/json-schema.interface";
import { DescriptorRelationship, TemplateField } from "../types/template-data.interface";
import { toCamelCase, pluralize, transformNames } from "./name-transformer";
import {
  isNewEntityStructure,
  getModelReference,
  getDescriptorName,
  resolveNewEntityImportPath,
} from "./import-resolver";
import { normalizeCypherType, getTsType, CypherType } from "../utils/type-utils";

/**
 * Map JSON relationship definition to descriptor relationship
 *
 * Key mappings:
 * - toNode: true → direction: "out" (relationship FROM this entity TO related)
 * - toNode: false → direction: "in" (relationship FROM related TO this entity)
 * - single: true → cardinality: "one"
 * - single: false → cardinality: "many"
 * - variant: "Author" → contextKey: "userId"
 * - variant: other → dtoKey: singular/plural based on cardinality
 *
 * @param rel - JSON relationship definition
 * @returns Descriptor relationship configuration
 */
export function mapRelationship(rel: JsonRelationshipDefinition): DescriptorRelationship {
  // Core mappings
  const direction = rel.toNode ? "out" : "in";
  const cardinality = rel.single ? "one" : "many";

  // Determine contextKey and dtoKey based on variant
  let contextKey: string | undefined;
  let dtoKey: string | undefined;

  if (rel.variant === "Author") {
    // Special case: Author variant uses contextKey
    contextKey = "userId";
  } else if (rel.variant) {
    // Other variants: use variant name as dtoKey
    // Pluralize only for "many" cardinality
    dtoKey = rel.single ? rel.variant.toLowerCase() : pluralize(rel.variant.toLowerCase());
  } else {
    // No variant: use entity name as dtoKey
    // Pluralize only for "many" cardinality
    dtoKey = rel.single ? rel.name.toLowerCase() : pluralize(rel.name.toLowerCase());
  }

  // Determine relationship key (what it's called in the descriptor)
  const key = toCamelCase(rel.variant || rel.name);

  // Related entity name transformations
  const relatedEntityNames = transformNames(rel.name, pluralize(rel.name.toLowerCase()));

  // Detect if related entity uses NEW structure (Descriptor pattern)
  const isNewStructure = isNewEntityStructure({
    directory: rel.directory,
    moduleName: relatedEntityNames.kebabCase,
  });

  // Get model reference based on structure type
  const model = getModelReference({
    isNewStructure,
    entityName: rel.name,
    variantName: rel.variant,
  });

  // NEW structure specific fields
  const descriptorName = isNewStructure ? getDescriptorName(rel.name) : undefined;
  const importPath = isNewStructure
    ? resolveNewEntityImportPath({
        directory: rel.directory,
        moduleName: relatedEntityNames.kebabCase,
      })
    : undefined;

  // Process relationship property fields (only supported for cardinality: "one")
  let fields: TemplateField[] | undefined;
  if (rel.fields && rel.fields.length > 0) {
    if (!rel.single) {
      throw new Error(
        `Relationship "${rel.name}" has fields but is not single (cardinality: one). ` +
          `Relationship properties are only supported for single relationships.`
      );
    }

    fields = rel.fields.map((field) => {
      const normalizedType = normalizeCypherType(field.type);
      if (!normalizedType) {
        throw new Error(
          `Invalid field type "${field.type}" for relationship field "${field.name}" ` +
            `on relationship "${rel.name}".`
        );
      }
      return {
        name: field.name,
        type: normalizedType,
        required: !field.nullable,
        tsType: getTsType(normalizedType),
      };
    });
  }

  return {
    key,
    model,
    direction,
    relationship: rel.relationshipName,
    cardinality,
    contextKey,
    dtoKey,
    required: !rel.nullable,
    relatedEntity: {
      name: rel.name,
      directory: rel.directory,
      pascalCase: relatedEntityNames.pascalCase,
      camelCase: relatedEntityNames.camelCase,
      kebabCase: relatedEntityNames.kebabCase,
    },
    isNewStructure,
    descriptorName,
    importPath,
    fields,
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
