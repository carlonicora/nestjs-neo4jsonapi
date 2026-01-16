/**
 * Entity Descriptor Interface
 *
 * Re-exports from entity.schema.interface.ts for the new schema-first approach.
 * Use defineEntity() to create descriptors with automatic derivation of:
 * - constraints (always UNIQUE id)
 * - indexes (FULLTEXT from string fields)
 * - field names, defaults, and required fields
 *
 * @example
 * ```typescript
 * import { defineEntity } from '../helpers/define-entity';
 *
 * export const GlossaryDescriptor = defineEntity<Glossary>()({
 *   model: GlossaryModel,
 *   fields: {
 *     name: { type: 'string', required: true },
 *     description: { type: 'string' },
 *   },
 *   relationships: {
 *     author: { model: authorMeta, direction: 'in', relationship: 'PUBLISHED', cardinality: 'one' },
 *     topic: { model: topicMeta, direction: 'out', relationship: 'RELEVANT_FOR', cardinality: 'many' },
 *   },
 * });
 *
 * // Access with autocomplete:
 * GlossaryDescriptor.relationships.author
 * GlossaryDescriptor.fieldNames
 * GlossaryDescriptor.stringFields
 * ```
 */
export type {
  CypherType,
  EntityDescriptor,
  EntitySchemaInput,
  FieldDef,
  RelationshipDef,
} from "./entity.schema.interface";

export { defineEntity, defineEntityAlias } from "../helpers/define-entity";
