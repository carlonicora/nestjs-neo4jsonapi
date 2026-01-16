import { Injectable, Type } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { BaseConfigInterface } from "../../config/interfaces";
import { JsonApiSerialiserFactory } from "../../core/jsonapi/factories/jsonapi.serialiser.factory";
import { DescriptorBasedSerialiser } from "../../core/jsonapi/serialisers/descriptor.based.serialiser";
import { mapEntity } from "../abstracts/entity";
import { DataModelInterface } from "../interfaces/datamodel.interface";
import {
  ComputedFieldDef,
  CypherType,
  EntityDescriptor,
  EntitySchemaInput,
  FieldDef,
  RelationshipDef,
} from "../interfaces/entity.schema.interface";

/**
 * Convert Neo4j Integer {low, high} to JavaScript number
 */
function convertNeo4jNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (value.low !== undefined) return value.low;
  return value;
}

/**
 * Convert Neo4j Date to JavaScript Date object
 */
function convertNeo4jDate(value: any): Date | null {
  if (!value) return null;

  // Handle Neo4j Date format: {year: {low, high}, month: {low, high}, day: {low, high}}
  if (value.year?.low !== undefined) {
    return new Date(value.year.low, value.month.low - 1, value.day.low);
  }

  // Already a Date or string, convert to Date
  return new Date(value);
}

/**
 * Convert Neo4j DateTime to JavaScript Date object
 */
function convertNeo4jDateTime(value: any): Date | null {
  if (!value) return null;

  // Handle Neo4j DateTime format
  if (value.year?.low !== undefined) {
    return new Date(
      value.year.low,
      value.month.low - 1,
      value.day.low,
      value.hour?.low ?? 0,
      value.minute?.low ?? 0,
      value.second?.low ?? 0,
    );
  }

  // Already a Date or string, convert to Date
  return new Date(value);
}

/**
 * Convert a Neo4j field value based on its CypherType
 */
function convertFieldValue(value: any, type: CypherType): any {
  if (value === null || value === undefined) return value;

  switch (type) {
    case "number":
      return convertNeo4jNumber(value);
    case "date":
      return convertNeo4jDate(value);
    case "datetime":
      return convertNeo4jDateTime(value);
    case "number[]":
      return Array.isArray(value) ? value.map(convertNeo4jNumber) : value;
    case "date[]":
      return Array.isArray(value) ? value.map((v) => convertNeo4jDate(v)) : value;
    case "datetime[]":
      return Array.isArray(value) ? value.map((v) => convertNeo4jDateTime(v)) : value;
    // string, boolean, json, string[], boolean[], json[] - no conversion needed
    default:
      return value;
  }
}

/**
 * Create a unique serialiser class for an entity descriptor.
 * The class extends DescriptorBasedSerialiser and has the descriptor pre-configured.
 */
function createSerialiserForDescriptor<T, R extends Record<string, RelationshipDef>>(
  descriptor: EntityDescriptor<T, R>,
  labelName: string,
): Type<DescriptorBasedSerialiser> {
  @Injectable()
  class AutoSerialiser extends DescriptorBasedSerialiser {
    constructor(
      serialiserFactory: JsonApiSerialiserFactory,
      moduleRef: ModuleRef,
      configService: ConfigService<BaseConfigInterface>,
    ) {
      super(serialiserFactory, moduleRef, configService);
      this.setDescriptor(descriptor);
    }
  }

  // Give it a unique name for debugging and DI registration
  Object.defineProperty(AutoSerialiser, "name", {
    value: `${labelName}AutoSerialiser`,
    writable: false,
  });

  return AutoSerialiser;
}

/**
 * Define an entity descriptor using a clean, declarative schema
 *
 * This function takes a schema definition and computes all derived values:
 * - Extracts field names, string fields, required fields, and defaults
 * - Generates UNIQUE constraint for 'id'
 * - Generates FULLTEXT index from string fields
 * - Auto-generates mapper function from fields and computed definitions
 * - Derives childrenTokens from relationships
 * - Creates a complete DataModelInterface
 *
 * @template T - The entity type (e.g., Glossary)
 * @template R - The relationships record type for autocomplete support
 *
 * @example
 * ```typescript
 * export const GlossaryDescriptor = defineEntity<Glossary>()({
 *   type: "glossaries",
 *   endpoint: "glossaries",
 *   nodeName: "glossary",
 *   labelName: "Glossary",
 *
 *   fields: {
 *     name: { type: 'string', required: true },
 *     description: { type: 'string' },
 *     aiStatus: { type: 'string', default: AiStatus.Pending, meta: true },
 *   },
 *
 *   computed: {
 *     relevance: {
 *       compute: (params) => params.record.has("totalScore") ? Number(params.record.get("totalScore")) : 0,
 *       meta: true,
 *     },
 *   },
 *
 *   relationships: {
 *     author: { model: authorMeta, direction: 'in', relationship: 'PUBLISHED', cardinality: 'one' },
 *     topic: { model: topicMeta, direction: 'out', relationship: 'RELEVANT_FOR', cardinality: 'many' },
 *   },
 * });
 *
 * // Access with autocomplete:
 * GlossaryDescriptor.model // DataModelInterface with mapper, childrenTokens, etc.
 * GlossaryDescriptor.relationships.author
 * GlossaryDescriptor.fieldNames // ['name', 'description', 'aiStatus']
 * ```
 */
export function defineEntity<T>() {
  return function <R extends Record<string, RelationshipDef>>(schema: EntitySchemaInput<T, R>): EntityDescriptor<T, R> {
    const {
      type,
      endpoint,
      nodeName,
      labelName,
      fields,
      relationships,
      computed = {},
      serialiser: customSerialiser,
      injectServices = [],
      isCompanyScoped = true,
    } = schema;

    // Extract field information
    const fieldEntries = Object.entries(fields) as [string, FieldDef][];
    const fieldNames = fieldEntries.map(([name]) => name);

    // String fields for FULLTEXT index
    const stringFields = fieldEntries.filter(([, def]) => def.type === "string").map(([name]) => name);

    // Required fields
    const requiredFields = fieldEntries.filter(([, def]) => def.required === true).map(([name]) => name);

    // Default values
    const fieldDefaults: Record<string, any> = {};
    for (const [name, def] of fieldEntries) {
      if (def.default !== undefined) {
        fieldDefaults[name] = def.default;
      }
    }

    // Generate index name
    const fulltextIndexName = `${nodeName}_search_index`;

    // Build relationship keys for autocomplete (e.g., descriptor.relationshipKeys.author returns "author")
    const relationshipKeys = Object.keys(relationships).reduce(
      (acc, key) => {
        acc[key as keyof R] = key as keyof R;
        return acc;
      },
      {} as { [K in keyof R]: K },
    );

    // Derive childrenTokens from relationships
    // singleChildrenTokens: company (if scoped) + cardinality 'one' relationships
    // childrenTokens: cardinality 'many' relationships
    const singleChildrenTokens: string[] = isCompanyScoped ? ["company"] : [];
    const childrenTokens: string[] = [];

    for (const [, rel] of Object.entries(relationships)) {
      if (rel.cardinality === "one") {
        singleChildrenTokens.push(rel.model.nodeName);
      } else {
        childrenTokens.push(rel.model.nodeName);
      }
    }

    // Auto-generate computed fields for relationship properties (edge fields)
    // These are stored on the relationship, not the node, and are retrieved as aliased columns
    // Only for SINGLE (cardinality: "one") relationships - MANY relationships use edgePropsCollection
    const autoComputed: { [key: string]: ComputedFieldDef } = {};
    for (const [relName, relDef] of Object.entries(relationships)) {
      if (relDef.fields && relDef.fields.length > 0 && relDef.cardinality === "one") {
        for (const field of relDef.fields) {
          const recordKey = `${nodeName}_${relName}_relationship_${field.name}`;
          autoComputed[field.name] = {
            compute: (params) => {
              if (params.record?.get && params.record.has(recordKey)) {
                return convertFieldValue(params.record.get(recordKey), field.type);
              }
              return null;
            },
            // No meta: true - relationship properties only appear in relationship.meta, not entity meta
          };
        }
      }
    }

    // Merge auto-computed with user-provided computed (user takes precedence)
    const mergedComputed = { ...autoComputed, ...computed };

    // Auto-generate mapper function from fields and computed definitions
    const mapper = (params: { data: any; record: any; entityFactory: any; name?: string }): T => {
      const result: any = {
        ...mapEntity({ record: params.data }),
      };

      // Map fields from data with type conversion
      for (const [fieldName, fieldDef] of fieldEntries) {
        const rawValue = params.data[fieldName];
        result[fieldName] = convertFieldValue(rawValue, fieldDef.type);
      }

      // Evaluate computed fields (includes auto-generated relationship property fields)
      for (const [fieldName, def] of Object.entries(mergedComputed) as [string, ComputedFieldDef][]) {
        result[fieldName] = def.compute(params);
      }

      // Initialize relationship placeholders
      if (isCompanyScoped) {
        result.company = undefined;
      }
      for (const [name, rel] of Object.entries(relationships)) {
        result[name] = rel.cardinality === "many" ? [] : undefined;
      }

      return result as T;
    };

    // Build descriptor first (without model and serialiser)
    const descriptor: EntityDescriptor<T, R> = {
      model: undefined as unknown as DataModelInterface<T>, // Will be set below
      isCompanyScoped,
      relationships,
      relationshipKeys,

      // Computed from fields
      fieldNames,
      stringFields,
      requiredFields,
      fieldDefaults,
      fields: fields as { [K in keyof Partial<T>]?: FieldDef },
      computed: mergedComputed as { [K in keyof Partial<T>]?: ComputedFieldDef },
      injectServices,

      // Auto-generated database config
      constraints: [{ property: "id", type: "UNIQUE" }],

      indexes:
        stringFields.length > 0
          ? [
              {
                name: fulltextIndexName,
                properties: stringFields,
                type: "FULLTEXT",
              },
            ]
          : [],

      fulltextIndexName: stringFields.length > 0 ? fulltextIndexName : "",
      defaultOrderBy: "updatedAt DESC",
    };

    // Auto-generate serialiser if not provided
    const serialiserClass = customSerialiser || createSerialiserForDescriptor(descriptor, labelName);

    // Create DataModelInterface with serialiser
    const model: DataModelInterface<T> = {
      type,
      endpoint,
      nodeName,
      labelName,
      entity: undefined as unknown as T,
      mapper,
      serialiser: serialiserClass,
      singleChildrenTokens,
      childrenTokens,
    };

    // Assign model to descriptor
    descriptor.model = model;

    return descriptor;
  };
}

/**
 * Create an alias descriptor from a base descriptor with different meta.
 *
 * Alias descriptors share the same entity type, fields, computed, and relationships
 * as the base descriptor, but have different type/endpoint/nodeName/labelName.
 *
 * This is useful for entities like User that have aliases (Owner, Author, Assignee)
 * which represent the same entity but appear as different relationship endpoints.
 *
 * @param baseDescriptor - The base EntityDescriptor to alias
 * @param aliasMeta - The DataMeta for the alias (type, endpoint, nodeName, labelName)
 * @returns A new EntityDescriptor with the alias meta
 *
 * @example
 * ```typescript
 * // In user.ts:
 * export const UserDescriptor = defineEntity<User>()({ ... });
 *
 * export const OwnerDescriptor = defineEntityAlias(UserDescriptor, ownerMeta);
 * export const AuthorDescriptor = defineEntityAlias(UserDescriptor, authorMeta);
 * export const AssigneeDescriptor = defineEntityAlias(UserDescriptor, assigneeMeta);
 * ```
 */
export function defineEntityAlias<T, R extends Record<string, RelationshipDef>>(
  baseDescriptor: EntityDescriptor<T, R>,
  aliasMeta: { type: string; endpoint: string; nodeName: string; labelName: string },
): EntityDescriptor<T, R> {
  // Create a new model with the alias meta
  const aliasModel: DataModelInterface<T> = {
    ...baseDescriptor.model,
    ...aliasMeta,
  };

  // Create a new descriptor that shares everything except the model
  return {
    ...baseDescriptor,
    model: aliasModel,
  };
}
