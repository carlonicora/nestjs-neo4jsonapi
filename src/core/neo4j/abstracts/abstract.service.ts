import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { EntityDescriptor, RelationshipDef } from "../../../common/interfaces/entity.schema.interface";
import { JsonApiDataInterface } from "../../jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../../jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../jsonapi/services/jsonapi.service";
import { AbstractRepository } from "./abstract.repository";

/**
 * JSON:API relationship item with optional per-item meta for edge properties
 */
export interface JsonApiDTORelationshipItem {
  id: string;
  type: string;
  /** Per-item meta for edge properties on MANY relationships */
  meta?: Record<string, any>;
}

/**
 * JSON:API DTO data structure for create/update operations
 */
export interface JsonApiDTOData {
  id: string;
  type: string;
  attributes?: Record<string, any>;
  relationships?: Record<
    string,
    {
      data: JsonApiDTORelationshipItem[] | JsonApiDTORelationshipItem | null;
      /** Relationship-level meta (e.g., edgeOnly flag for edge-only updates) */
      meta?: Record<string, any>;
    }
  >;
}

/**
 * Abstract base service for Neo4j entities
 *
 * This class provides generic CRUD operations with JSON:API response formatting.
 * Works in conjunction with AbstractRepository and EntityDescriptor.
 *
 * @template T - The entity type (e.g., Glossary, Article, Topic)
 * @template R - The relationships record type for autocomplete support
 *
 * Usage pattern:
 * ```typescript
 * @Injectable()
 * export class GlossaryService extends AbstractService<Glossary, typeof GlossaryDescriptor.relationships> {
 *   constructor(
 *     jsonApiService: JsonApiService,
 *     glossaryRepository: GlossaryRepository,
 *     clsService: ClsService,
 *   ) {
 *     super(jsonApiService, glossaryRepository, clsService, GlossaryModel);
 *   }
 *
 *   // Generic methods (find, findById, create, put, patch, delete, findByRelated) are inherited
 *   // Domain-specific methods can be added here
 * }
 * ```
 */
export abstract class AbstractService<
  T extends { id: string; company?: { id: string } },
  R extends Record<string, RelationshipDef> = Record<string, RelationshipDef>,
> {
  /** Entity descriptor with field and relationship definitions */
  protected abstract readonly descriptor: EntityDescriptor<T, R>;

  constructor(
    protected readonly jsonApiService: JsonApiService,
    protected readonly repository: AbstractRepository<T, R>,
    protected readonly clsService: ClsService,
    protected readonly model: DataModelInterface<T>,
  ) {}

  /**
   * Find entities with optional search term, ordering, and pagination
   */
  async find(params: {
    query: any;
    term?: string;
    fetchAll?: boolean;
    orderBy?: string;
  }): Promise<JsonApiDataInterface> {
    const paginator = new JsonApiPaginator(params.query);

    return this.jsonApiService.buildList(
      this.model,
      await this.repository.find({
        fetchAll: params.fetchAll,
        term: params.term,
        orderBy: params.orderBy,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  /**
   * Find entity by ID
   */
  async findById(params: { id: string }): Promise<JsonApiDataInterface> {
    return this.jsonApiService.buildSingle(this.model, await this.repository.findById({ id: params.id }));
  }

  /**
   * Create a new entity
   * Override this method to map DTO fields to repository create params
   */
  async create(params: { id: string; [key: string]: any }): Promise<JsonApiDataInterface> {
    await this.repository.create(params);
    return this.findById({ id: params.id });
  }

  /**
   * Update an existing entity (full update)
   * Override this method to map DTO fields to repository put params
   */
  async put(params: { id: string; [key: string]: any }): Promise<JsonApiDataInterface> {
    await this.repository.put(params);
    return this.findById({ id: params.id });
  }

  /**
   * Partial update - only updates fields that are explicitly passed
   * Override this method to map DTO fields to repository patch params
   */
  async patch(params: { id: string; [key: string]: any }): Promise<JsonApiDataInterface> {
    await this.repository.patch(params);
    return this.findById({ id: params.id });
  }

  /**
   * Delete an entity
   * Validates ownership before deletion
   */
  async delete(params: { id: string }): Promise<void> {
    const entity = await this.repository.findById({ id: params.id });
    if (!entity) throw new NotFoundException();

    const userId = this.clsService.get("userId");
    const companyId = this.clsService.get("companyId");

    if (!userId || (companyId ?? "") !== entity.company?.id) {
      throw new ForbiddenException();
    }

    await this.repository.delete({ id: params.id });
  }

  /**
   * Map JSON:API DTO data to repository params
   * Extracts attributes and relationships based on descriptor definitions
   */
  protected mapDTOToParams(data: JsonApiDTOData): { id: string; [key: string]: any } {
    const params: { id: string; [key: string]: any } = { id: data.id };

    // Map all fields from descriptor - use DTO value, default, or null
    for (const fieldName of this.descriptor.fieldNames) {
      if (data.attributes && fieldName in data.attributes) {
        params[fieldName] = data.attributes[fieldName];
      } else if (fieldName in this.descriptor.fieldDefaults) {
        params[fieldName] = this.descriptor.fieldDefaults[fieldName];
      } else {
        params[fieldName] = null;
      }
    }

    // Map relationships
    for (const [relationshipKey, relationshipDef] of Object.entries(this.descriptor.relationships)) {
      if (relationshipDef.contextKey) {
        // Value comes from CLS context (e.g., userId for author)
        params[relationshipKey] = this.clsService.get(relationshipDef.contextKey);
      } else {
        // Value comes from DTO relationships
        const dtoKey = relationshipDef.dtoKey || relationshipKey;
        const relationshipEntry = data.relationships?.[dtoKey];
        const relationshipData = relationshipEntry?.data;

        if (relationshipData) {
          if (Array.isArray(relationshipData)) {
            // MANY relationship
            params[relationshipKey] = relationshipData.map((item) => item.id);

            // Build edge properties map for MANY relationships with fields
            if (relationshipDef.fields && relationshipDef.fields.length > 0) {
              const edgePropsMap: Record<string, Record<string, any>> = {};
              for (const item of relationshipData) {
                edgePropsMap[item.id] = {};
                for (const field of relationshipDef.fields) {
                  if (item.meta && field.name in item.meta) {
                    edgePropsMap[item.id][field.name] = item.meta[field.name];
                  } else if (field.default !== undefined) {
                    edgePropsMap[item.id][field.name] = field.default;
                  } else if (field.required) {
                    throw new BadRequestException(
                      `Missing required edge property '${field.name}' for relationship item '${item.id}'`,
                    );
                  }
                }
              }
              params[`${relationshipKey}EdgeProps`] = edgePropsMap;
            }
          } else {
            // SINGLE relationship
            params[relationshipKey] = relationshipData.id;

            // Map relationship property fields from item-level meta (new) or relationship-level meta (legacy)
            if (relationshipDef.fields && relationshipDef.fields.length > 0) {
              const itemMeta = relationshipData.meta;
              const relMeta = relationshipEntry?.meta;
              const sourceMeta = itemMeta || relMeta; // Prefer item-level, fallback to rel-level for backwards compat

              for (const field of relationshipDef.fields) {
                if (sourceMeta && field.name in sourceMeta) {
                  params[field.name] = sourceMeta[field.name];
                } else if (field.default !== undefined) {
                  params[field.name] = field.default;
                }
              }
            }
          }
        } else {
          // No data provided - use empty array for 'many', undefined for 'one'
          params[relationshipKey] = relationshipDef.cardinality === "many" ? [] : undefined;
        }
      }
    }

    return params;
  }

  /**
   * Create a new entity from JSON:API DTO
   * Automatically maps attributes and relationships based on descriptor
   */
  async createFromDTO(params: { data: JsonApiDTOData }): Promise<JsonApiDataInterface> {
    const repoParams = this.mapDTOToParams(params.data);
    return this.create(repoParams);
  }

  /**
   * Update an existing entity from JSON:API DTO (full update)
   * Automatically maps attributes and relationships based on descriptor
   */
  async putFromDTO(params: { data: JsonApiDTOData }): Promise<JsonApiDataInterface> {
    const repoParams = this.mapDTOToParams(params.data);
    return this.put(repoParams);
  }

  /**
   * Partial update from JSON:API DTO
   * Only updates fields that are explicitly present in the DTO
   */
  async patchFromDTO(params: { data: JsonApiDTOData }): Promise<JsonApiDataInterface> {
    const repoParams = this.mapDTOToPatchParams(params.data);
    return this.patch(repoParams);
  }

  /**
   * Map JSON:API DTO data to patch params (only includes fields present in DTO)
   * Supports edge-only updates via meta.edgeOnly flag for MANY relationships
   */
  protected mapDTOToPatchParams(data: JsonApiDTOData): { id: string; [key: string]: any } {
    const params: { id: string; [key: string]: any } = { id: data.id };

    // Only include attributes that are explicitly provided (regular fields only)
    if (data.attributes) {
      for (const [key, value] of Object.entries(data.attributes)) {
        if (this.descriptor.fieldNames.includes(key)) {
          params[key] = value;
        }
      }
    }

    // Only include relationships that are explicitly provided
    if (data.relationships) {
      for (const [dtoKey, relationshipValue] of Object.entries(data.relationships)) {
        // Find the relationship definition that matches this DTO key
        const [relationshipKey, relationshipDef] =
          Object.entries(this.descriptor.relationships).find(
            ([key, def]) => (def.dtoKey || key) === dtoKey && !def.contextKey,
          ) || [];

        if (relationshipKey && relationshipDef && relationshipValue?.data !== undefined) {
          const relationshipData = relationshipValue.data;
          const isEdgeOnly = relationshipValue?.meta?.edgeOnly === true;

          if (Array.isArray(relationshipData)) {
            // MANY relationship
            if (isEdgeOnly && relationshipDef.fields && relationshipDef.fields.length > 0) {
              // Edge-only update: only update edge properties, don't modify linked items
              const edgePropsMap: Record<string, Record<string, any>> = {};
              for (const item of relationshipData) {
                if (item.meta) {
                  edgePropsMap[item.id] = {};
                  for (const field of relationshipDef.fields) {
                    if (field.name in item.meta) {
                      edgePropsMap[item.id][field.name] = item.meta[field.name];
                    }
                  }
                }
              }
              params[`${relationshipKey}EdgePropsUpdate`] = edgePropsMap;
            } else {
              // Normal update: replace linked items and set edge properties
              params[relationshipKey] = relationshipData.map((item) => item.id);

              // Build edge properties map for MANY relationships with fields
              if (relationshipDef.fields && relationshipDef.fields.length > 0) {
                const edgePropsMap: Record<string, Record<string, any>> = {};
                for (const item of relationshipData) {
                  edgePropsMap[item.id] = {};
                  for (const field of relationshipDef.fields) {
                    if (item.meta && field.name in item.meta) {
                      edgePropsMap[item.id][field.name] = item.meta[field.name];
                    }
                  }
                }
                params[`${relationshipKey}EdgeProps`] = edgePropsMap;
              }
            }
          } else if (relationshipData) {
            // SINGLE relationship
            params[relationshipKey] = relationshipData.id;

            // Map relationship property fields from item-level meta (new) or relationship-level meta (legacy)
            if (relationshipDef.fields && relationshipDef.fields.length > 0) {
              const itemMeta = relationshipData.meta;
              const relMeta = relationshipValue?.meta;
              const sourceMeta = itemMeta || relMeta;

              for (const field of relationshipDef.fields) {
                if (sourceMeta && field.name in sourceMeta) {
                  params[field.name] = sourceMeta[field.name];
                }
              }
            }
          } else {
            params[relationshipKey] = relationshipDef.cardinality === "many" ? [] : undefined;
          }
        }
      }
    }

    return params;
  }

  /**
   * Find entities by a related entity
   *
   * @example
   * ```typescript
   * // Find all glossaries by a specific author
   * await service.findByRelated({ relationship: 'author', id: 'author-123', query: req.query });
   *
   * // Find all glossaries related to specific topics
   * await service.findByRelated({ relationship: 'topic', id: ['topic-1', 'topic-2'], query: req.query });
   * ```
   */
  async findByRelated(params: {
    relationship: keyof R & string;
    id: string | string[];
    query: any;
    term?: string;
    fetchAll?: boolean;
    orderBy?: string;
  }): Promise<JsonApiDataInterface> {
    const paginator = new JsonApiPaginator(params.query);

    return this.jsonApiService.buildList(
      this.model,
      await this.repository.findByRelated({
        relationship: params.relationship,
        id: params.id,
        fetchAll: params.fetchAll,
        term: params.term,
        orderBy: params.orderBy,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  /**
   * Add items to a to-many relationship from JSON:API DTO
   *
   * @example
   * ```typescript
   * // Add photographs to a contact sheet with edge properties
   * await service.addToRelationshipFromDTO({
   *   id: 'contact-sheet-123',
   *   relationship: 'photograph',
   *   data: [
   *     { id: 'photo-1', type: 'photographs', meta: { position: 1, selected: true } },
   *     { id: 'photo-2', type: 'photographs', meta: { position: 2 } }
   *   ]
   * });
   * ```
   */
  async addToRelationshipFromDTO(params: {
    id: string;
    relationship: keyof R & string;
    data: JsonApiDTORelationshipItem | JsonApiDTORelationshipItem[];
  }): Promise<JsonApiDataInterface> {
    const relationshipDef = this.descriptor.relationships[params.relationship];

    if (!relationshipDef) {
      throw new BadRequestException(`Unknown relationship: ${params.relationship}`);
    }

    // Normalize data to array
    const dataArray = Array.isArray(params.data) ? params.data : [params.data];

    // Build items with edge properties
    const items = dataArray.map((item) => {
      const edgeProps: Record<string, any> = {};

      // Extract edge properties from meta if relationship has fields
      if (relationshipDef.fields && relationshipDef.fields.length > 0 && item.meta) {
        for (const field of relationshipDef.fields) {
          if (field.name in item.meta) {
            edgeProps[field.name] = item.meta[field.name];
          } else if (field.default !== undefined) {
            edgeProps[field.name] = field.default;
          } else if (field.required) {
            throw new BadRequestException(
              `Missing required edge property '${field.name}' for relationship item '${item.id}'`,
            );
          }
        }
      }

      return { id: item.id, edgeProps };
    });

    await this.repository.addToRelationship({
      id: params.id,
      relationship: params.relationship,
      items,
    });

    return this.findById({ id: params.id });
  }

  /**
   * Remove items from a to-many relationship
   *
   * @example
   * ```typescript
   * // Remove photographs from a contact sheet
   * await service.removeFromRelationshipFromDTO({
   *   id: 'contact-sheet-123',
   *   relationship: 'photograph',
   *   data: [
   *     { id: 'photo-1', type: 'photographs' },
   *     { id: 'photo-2', type: 'photographs' }
   *   ]
   * });
   * ```
   */
  async removeFromRelationshipFromDTO(params: {
    id: string;
    relationship: keyof R & string;
    data: { id: string; type: string }[];
  }): Promise<JsonApiDataInterface> {
    const relationshipDef = this.descriptor.relationships[params.relationship];

    if (!relationshipDef) {
      throw new BadRequestException(`Unknown relationship: ${params.relationship}`);
    }

    await this.repository.removeFromRelationship({
      id: params.id,
      relationship: params.relationship,
      itemIds: params.data.map((item) => item.id),
    });

    return this.findById({ id: params.id });
  }
}
