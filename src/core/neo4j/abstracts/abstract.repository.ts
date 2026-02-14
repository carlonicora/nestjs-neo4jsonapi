import { HttpException, HttpStatus, OnModuleInit } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { EntityDescriptor, RelationshipDef } from "../../../common/interfaces/entity.schema.interface";
import { JsonApiCursorInterface } from "../../jsonapi/interfaces/jsonapi.cursor.interface";
import { SecurityService } from "../../security/services/security.service";
import { updateRelationshipQuery } from "../queries/update.relationship";
import { Neo4jService } from "../services/neo4j.service";

/**
 * Abstract base repository for Neo4j entities
 *
 * This class provides generic CRUD operations using the schema-first EntityDescriptor pattern.
 * Fields and relationships are defined once in the descriptor, and everything else is derived.
 *
 * @template T - The entity type (e.g., Glossary, Article, Topic)
 * @template R - The relationships record type for autocomplete support
 *
 * Usage pattern:
 * ```typescript
 * export class GlossaryRepository extends AbstractRepository<Glossary, typeof GlossaryDescriptor.relationships> {
 *   protected readonly descriptor = GlossaryDescriptor;
 *
 *   constructor(
 *     neo4j: Neo4jService,
 *     securityService: SecurityService,
 *   ) {
 *     super(neo4j, securityService);
 *   }
 *
 *   // Generic methods (find, findById, create, put, patch, delete, findByRelated) are inherited
 *   // Domain-specific methods can be added here
 * }
 * ```
 */
export abstract class AbstractRepository<
  T,
  R extends Record<string, RelationshipDef> = Record<string, RelationshipDef>,
> implements OnModuleInit {
  protected abstract readonly descriptor: EntityDescriptor<T, R>;

  constructor(
    protected readonly neo4j: Neo4jService,
    protected readonly securityService: SecurityService,
    protected readonly clsService: ClsService,
  ) {}

  async onModuleInit() {
    const { constraints, indexes, model } = this.descriptor;
    const { nodeName, labelName } = model;

    // Create constraints
    for (const constraint of constraints) {
      await this.neo4j.writeOne({
        query: `CREATE CONSTRAINT ${nodeName}_${constraint.property} IF NOT EXISTS FOR (${nodeName}:${labelName}) REQUIRE ${nodeName}.${constraint.property} IS UNIQUE`,
      });
    }

    // Create indexes
    if (indexes) {
      for (const index of indexes) {
        if (index.type === "FULLTEXT") {
          // Check if index exists and matches expected configuration
          const result = await this.neo4j.read(
            `
            SHOW INDEXES
            YIELD name, type, entityType, labelsOrTypes, properties
            WHERE name = $indexName AND type = 'FULLTEXT' AND entityType = 'NODE'
            RETURN labelsOrTypes AS labels, properties
          `,
            { indexName: index.name },
          );

          const match = result.records[0];
          const labels = match?.get("labels") ?? [];
          const properties = match?.get("properties") ?? [];

          const arraysEqual = (a: string[], b: string[]) => a.length === b.length && a.every((val) => b.includes(val));

          if (!match || !arraysEqual(labels, [labelName]) || !arraysEqual(properties, index.properties)) {
            await this.neo4j.writeOne({
              query: `
                CREATE FULLTEXT INDEX \`${index.name}\` IF NOT EXISTS
                FOR (n:${[labelName].map((l) => `\`${l}\``).join(" | ")})
                ON EACH [${index.properties.map((p) => `n.\`${p}\``).join(", ")}]
              `,
              queryParams: {},
            });
          }
        }
      }
    }
  }

  /**
   * Builds the default MATCH query for the entity
   */
  protected buildDefaultMatch(options?: { searchField?: string; blockCompanyAndUser?: boolean }): string {
    const { nodeName, labelName } = this.descriptor.model;
    const { isCompanyScoped } = this.descriptor;

    const companyId = this.clsService.get("companyId");
    const currentUserId = this.clsService.get("userId");

    // Generic entities - no company filtering
    if (!isCompanyScoped) {
      return `
        MATCH (${nodeName}:${labelName}${options?.searchField ? ` {${options.searchField}: $searchValue}` : ``})
        WITH ${nodeName}
      `;
    }

    // Company-scoped entities - standard filtering
    return `
      MATCH (${nodeName}:${labelName}${options?.searchField ? ` {${options.searchField}: $searchValue}` : ``})
      WHERE $companyId IS NULL
      OR EXISTS {
        MATCH (${nodeName})-[:BELONGS_TO]-(company)
      }
      WITH ${nodeName}${options?.blockCompanyAndUser ? `` : `${companyId ? `, company` : ``}${currentUserId ? `, currentUser` : ``}`}
    `;
  }

  /**
   * Builds the user access validation snippet
   */
  protected buildUserHasAccess(): string {
    const { nodeName } = this.descriptor.model;
    return `WITH ${nodeName}`;
  }

  /**
   * Builds the RETURN statement including all relationships from descriptor
   * For relationships with fields (edge properties):
   * - SINGLE relationships: uses aliased columns for edge properties
   * - MANY relationships: aggregates edge props FIRST, then UNWINDs nodes for inclusion
   *
   * This ensures readOne() gets complete edge props collections even with multiple related entities.
   */
  protected buildReturnStatement(): string {
    const { nodeName, labelName } = this.descriptor.model;
    const { relationships, isCompanyScoped } = this.descriptor;

    let query = "";
    const returnParts = [nodeName];
    const collectParts: string[] = []; // For MANY relationships with edge fields
    const manyRelationshipsWithFields: Array<{ name: string; relatedNodeName: string }> = [];

    // Match company relationship only for company-scoped entities
    if (isCompanyScoped) {
      query += `MATCH (${nodeName}:${labelName})-[:BELONGS_TO]->(${nodeName}_company:Company)\n`;
      returnParts.push(`${nodeName}_company`);
    }

    // Build relationship matches from descriptor
    for (const [name, rel] of Object.entries(relationships)) {
      // Skip company relationship for company-scoped entities - already handled above
      if (isCompanyScoped && name === "company" && rel.relationship === "BELONGS_TO") {
        continue;
      }
      const relatedNodeName = `${nodeName}_${name}`;
      const relAlias = `${nodeName}_${name}_relationship`;
      // Use OPTIONAL MATCH for: many cardinality OR optional single relationships (required: false)
      const isOptional = rel.cardinality === "many" || rel.required === false;
      const matchType = isOptional ? "OPTIONAL MATCH" : "MATCH";

      // Use named relationship pattern when fields exist to capture edge properties
      const hasFields = rel.fields && rel.fields.length > 0;
      const relPattern = hasFields ? `[${relAlias}:${rel.relationship}]` : `[:${rel.relationship}]`;

      if (rel.direction === "in") {
        // (related)-[:REL]->(this)
        query += `${matchType} (${nodeName})<-${relPattern}-(${relatedNodeName}:${rel.model.labelName})\n`;
      } else {
        // (this)-[:REL]->(related)
        query += `${matchType} (${nodeName})-${relPattern}->(${relatedNodeName}:${rel.model.labelName})\n`;
      }

      // Add polymorphic discriminator existence check
      if (rel.polymorphic?.discriminatorRelationship) {
        const discRel = rel.polymorphic.discriminatorRelationship;
        const discDir = rel.polymorphic.discriminatorDirection ?? "out";
        const hasParentAlias = `${relatedNodeName}_hasParent`;
        if (discDir === "out") {
          returnParts.push(`EXISTS((${relatedNodeName})-[:${discRel}]->()) AS ${hasParentAlias}`);
        } else {
          returnParts.push(`EXISTS((${relatedNodeName})<-[:${discRel}]-()) AS ${hasParentAlias}`);
        }

        // Optionally fetch the discriminator target (parent) for inclusion
        if (rel.polymorphic.includeDiscriminatorTarget) {
          const discTargetNodeName = `${relatedNodeName}_discTarget`;
          if (discDir === "out") {
            query += `OPTIONAL MATCH (${relatedNodeName})-[:${discRel}]->(${discTargetNodeName}:${rel.model.labelName})\n`;
          } else {
            query += `OPTIONAL MATCH (${relatedNodeName})<-[:${discRel}]-(${discTargetNodeName}:${rel.model.labelName})\n`;
          }
          returnParts.push(discTargetNodeName);
        }
      }

      // Add edge properties handling
      if (hasFields) {
        if (rel.cardinality === "one") {
          // SINGLE relationship: aliased columns for edge properties (existing behavior)
          returnParts.push(relatedNodeName);
          for (const field of rel.fields!) {
            returnParts.push(`${relAlias}.${field.name} AS ${nodeName}_${name}_relationship_${field.name}`);
          }
        } else {
          // MANY relationship with fields: aggregate nodes and edge props together
          // Don't add to returnParts yet - will UNWIND after aggregation
          manyRelationshipsWithFields.push({ name, relatedNodeName });
          collectParts.push(`COLLECT(DISTINCT ${relatedNodeName}) AS ${relatedNodeName}s`);
          const edgePropsFields = rel.fields!.map((f) => `${f.name}: ${relAlias}.${f.name}`).join(", ");
          collectParts.push(
            `COLLECT(CASE WHEN ${relatedNodeName} IS NOT NULL THEN { nodeId: ${relatedNodeName}.id, edgeProps: {${edgePropsFields}} } END) AS ${nodeName}_${name}_edgePropsCollection`,
          );
        }
      } else {
        // No fields - just include the related node directly
        returnParts.push(relatedNodeName);
      }
    }

    // Build the final query
    if (collectParts.length > 0) {
      // Aggregate MANY relationships with edge props FIRST (reduces to 1 row)
      query += `WITH ${returnParts.join(", ")}, ${collectParts.join(", ")}\n`;

      // UNWIND the collected nodes for EntityFactory inclusion
      // All rows after UNWIND share the same edgePropsCollection
      for (const { relatedNodeName } of manyRelationshipsWithFields) {
        query += `UNWIND CASE WHEN size(${relatedNodeName}s) > 0 THEN ${relatedNodeName}s ELSE [null] END AS ${relatedNodeName}\n`;
        returnParts.push(relatedNodeName);
      }

      // Build RETURN with all parts plus the edgePropsCollections
      const edgePropsCollectionNames = collectParts
        .filter((p) => p.includes("_edgePropsCollection"))
        .map((p) => p.split(" AS ")[1]);
      query += `RETURN ${returnParts.join(", ")}, ${edgePropsCollectionNames.join(", ")}`;
    } else {
      query += `RETURN ${returnParts.join(", ")}`;
    }

    return query;
  }

  /**
   * Validates if the user has access to the entity
   * Throws Forbidden exception if entity exists but user doesn't have access
   */
  protected async _validateForbidden(params: {
    response: T | null;
    searchField: string;
    searchValue: string;
  }): Promise<T | null> {
    if (params.response) return params.response;

    const existsQuery = this.neo4j.initQuery({ serialiser: this.descriptor.model });
    existsQuery.queryParams = { companyId: null, currentUserId: null, searchValue: params.searchValue };
    existsQuery.query = `
      ${this.buildDefaultMatch({ searchField: params.searchField, blockCompanyAndUser: true })}
      ${this.buildReturnStatement()}
    `;
    const exists = await this.neo4j.readOne(existsQuery);

    if (exists) throw new HttpException(`Forbidden`, HttpStatus.FORBIDDEN);

    return null;
  }

  /**
   * Find entities with optional search term, ordering, and pagination
   */
  async find(params: {
    fetchAll?: boolean;
    term?: string;
    orderBy?: string;
    cursor?: JsonApiCursorInterface;
  }): Promise<T[]> {
    const { nodeName } = this.descriptor.model;
    const query = this.neo4j.initQuery({
      cursor: params.cursor,
      serialiser: this.descriptor.model,
      fetchAll: params.fetchAll,
    });

    query.queryParams = {
      ...query.queryParams,
      term: params.term ? `*${params.term.toLowerCase()}*` : undefined,
    };

    if (params.term && this.descriptor.fulltextIndexName) {
      // Use fulltext search if term is provided and index exists
      query.query += `CALL db.index.fulltext.queryNodes("${this.descriptor.fulltextIndexName}", $term)
      YIELD node, score
      ${this.descriptor.isCompanyScoped ? `WHERE (node)-[:BELONGS_TO]->(company)` : ``}

      WITH node as ${nodeName}, score
      ORDER BY score DESC
    `;
    } else {
      // Use default query with ordering
      query.query += `
      ${this.buildDefaultMatch()}
      ${this.securityService.userHasAccess({ validator: () => this.buildUserHasAccess() })}

      ORDER BY ${nodeName}.${params.orderBy ?? this.descriptor.defaultOrderBy ?? "updatedAt DESC"}
    `;
    }

    query.query += `
      {CURSOR}

      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Find entity by ID with security validation
   */
  async findById(params: { id: string }): Promise<T> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      ...query.queryParams,
      searchValue: params.id,
    };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      ${this.securityService.userHasAccess({ validator: () => this.buildUserHasAccess() })}
      ${this.buildReturnStatement()}
    `;

    return this._validateForbidden({
      response: await this.neo4j.readOne(query),
      searchField: "id",
      searchValue: params.id,
    });
  }

  /**
   * Find entities by ID list
   */
  async findByIds(params: { ids: string[] }): Promise<T[]> {
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      ...query.queryParams,
      ids: params.ids,
    };

    query.query += `
      ${this.buildDefaultMatch()}
      ${this.securityService.userHasAccess({ validator: () => this.buildUserHasAccess() })}
      WHERE ${this.descriptor.model.nodeName}.id IN $ids
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Find entities by a related entity
   *
   * @param relationship - The relationship name (e.g., 'author', 'topic')
   * @param id - Single ID or array of IDs of the related entity
   *
   * @example
   * ```typescript
   * // Find all glossaries by a specific author
   * await repository.findByRelated({ relationship: 'author', id: 'author-123' });
   *
   * // Find all glossaries related to specific topics
   * await repository.findByRelated({ relationship: 'topic', id: ['topic-1', 'topic-2'] });
   * ```
   */
  async findByRelated(params: {
    relationship: keyof R & string;
    id: string | string[];
    term?: string;
    orderBy?: string;
    fetchAll?: boolean;
    cursor?: JsonApiCursorInterface;
  }): Promise<T[]> {
    const { nodeName } = this.descriptor.model;
    const rel = this.descriptor.relationships[params.relationship];

    if (!rel) {
      throw new HttpException(`Unknown relationship: ${params.relationship}`, HttpStatus.BAD_REQUEST);
    }

    const relatedIds = Array.isArray(params.id) ? params.id : [params.id];

    const query = this.neo4j.initQuery({
      cursor: params.cursor,
      serialiser: this.descriptor.model,
      fetchAll: params.fetchAll,
    });

    query.queryParams = {
      ...query.queryParams,
      relatedIds,
      term: params.term,
    };

    if (params.term && this.descriptor.fulltextIndexName) {
      // Use fulltext search with relationship filter
      query.query += `CALL db.index.fulltext.queryNodes("${this.descriptor.fulltextIndexName}", $term)
      YIELD node, score
      ${this.descriptor.isCompanyScoped ? `WHERE (node)-[:BELONGS_TO]->(company)` : `WHERE true`}
      `;

      // Add relationship filter based on direction
      if (rel.direction === "in") {
        query.query += `AND (node)<-[:${rel.relationship}]-(:${rel.model.labelName} WHERE id IN $relatedIds)\n`;
      } else {
        query.query += `AND (node)-[:${rel.relationship}]->(:${rel.model.labelName} WHERE id IN $relatedIds)\n`;
      }

      query.query += `WITH node as ${nodeName}, score
      ORDER BY score DESC
    `;
    } else {
      // Use default query with relationship match
      query.query += `
      ${this.buildDefaultMatch()}
      `;

      // Add relationship match based on direction
      if (rel.direction === "in") {
        query.query += `MATCH (${nodeName})<-[:${rel.relationship}]-(related:${rel.model.labelName})
        WHERE related.id IN $relatedIds\n`;
      } else {
        query.query += `MATCH (${nodeName})-[:${rel.relationship}]->(related:${rel.model.labelName})
        WHERE related.id IN $relatedIds\n`;
      }

      query.query += `
      ${this.securityService.userHasAccess({ validator: () => this.buildUserHasAccess() })}

      ORDER BY ${nodeName}.${params.orderBy ?? this.descriptor.defaultOrderBy ?? "updatedAt DESC"}
    `;
    }

    query.query += `
      {CURSOR}

      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Create a new entity with relationships
   * Uses descriptor.fieldNames and descriptor.fieldDefaults for properties
   * Uses descriptor.relationships for creating relationships
   */
  async create(params: { id: string; [key: string]: any }): Promise<void> {
    const { nodeName, labelName } = this.descriptor.model;
    const { fieldNames, fieldDefaults, fields, relationships } = this.descriptor;
    const query = this.neo4j.initQuery();

    // Validate related nodes exist
    const nodesToValidate: Array<{ id: string; label: string }> = [];
    for (const [name, rel] of Object.entries(relationships)) {
      const paramValue = params[name];
      if (paramValue) {
        const ids = Array.isArray(paramValue) ? paramValue : [paramValue];
        nodesToValidate.push(...ids.map((id) => ({ id, label: rel.model.labelName })));
      }
    }

    if (nodesToValidate.length > 0) {
      await this.neo4j.validateExistingNodes({ nodes: nodesToValidate.filter(Boolean) });
    }

    // Apply defaults for fields not provided in params
    const mergedParams = { ...fieldDefaults, ...params };

    // Only include fields that have actual values (not undefined)
    const fieldsWithValues = fieldNames.filter((field) => mergedParams[field] !== undefined);

    // Build query parameters (only for fields with values)
    query.queryParams = {
      ...query.queryParams,
      id: mergedParams.id,
    };

    for (const field of fieldsWithValues) {
      query.queryParams[field] = mergedParams[field];
    }

    // Build field assignments for CREATE with proper Cypher type casting
    // Only include fields that have values
    const fieldAssignments = fieldsWithValues
      .map((fieldName) => {
        const fieldDef = fields[fieldName as keyof typeof fields];
        const fieldType = fieldDef?.type;
        if (fieldType === "datetime") {
          return `${fieldName}: datetime($${fieldName})`;
        } else if (fieldType === "date") {
          return `${fieldName}: date(left($${fieldName}, 10))`;
        } else if (fieldType === "datetime[]") {
          return `${fieldName}: [x IN $${fieldName} | datetime(x)]`;
        } else if (fieldType === "date[]") {
          return `${fieldName}: [x IN $${fieldName} | date(left(x, 10))]`;
        }
        return `${fieldName}: $${fieldName}`;
      })
      .join(",\n        ");

    // Create node with fields from descriptor
    query.query += `
      CREATE (${nodeName}:${labelName} {
        id: $id,
        ${fieldAssignments ? fieldAssignments + "," : ""}
        createdAt: datetime(),
        updatedAt: datetime()
      })
    `;

    // Create company relationship only for company-scoped entities
    if (this.descriptor.isCompanyScoped) {
      query.query += `CREATE (${nodeName})-[:BELONGS_TO]->(company)\n`;
    }

    // Create relationships
    for (const [name, rel] of Object.entries(relationships)) {
      // Skip company relationship if isCompanyScoped - it's already handled above
      if (this.descriptor.isCompanyScoped && rel.relationship === "BELONGS_TO" && rel.model.labelName === "Company") {
        continue;
      }

      const paramValue = mergedParams[name];
      // Add param to query params
      query.queryParams[name] = paramValue ? (Array.isArray(paramValue) ? paramValue : [paramValue]) : [];

      // Build relationship properties resolver if relationship has fields
      let relationshipProperties: ((id: string) => Record<string, any>) | undefined;
      if (rel.fields && rel.fields.length > 0 && paramValue) {
        const edgePropsMap = mergedParams[`${name}EdgeProps`];

        if (edgePropsMap) {
          // MANY relationship: use per-item edge properties map
          relationshipProperties = (id: string) => edgePropsMap[id] || {};
        } else {
          // SINGLE relationship: all edges get same props (existing behavior)
          relationshipProperties = (_id: string) => {
            const props: Record<string, any> = {};
            for (const field of rel.fields!) {
              if (mergedParams[field.name] !== undefined) {
                props[field.name] = mergedParams[field.name];
              }
            }
            return props;
          };
        }
      }

      query.query += updateRelationshipQuery({
        node: nodeName,
        relationshipName: rel.relationship,
        relationshipToNode: rel.direction === "out",
        label: rel.model.labelName,
        param: name,
        values: paramValue ? (Array.isArray(paramValue) ? paramValue : [paramValue]) : [],
        relationshipProperties,
        queryParams: query.queryParams,
      });
    }

    await this.neo4j.writeOne(query);
  }

  /**
   * Update an existing entity (full update - all fields are set)
   * Uses descriptor.fieldNames for properties
   * Uses descriptor.relationships for updating relationships
   */
  async put(params: { id: string; [key: string]: any }): Promise<void> {
    const { nodeName, labelName } = this.descriptor.model;
    const { fieldNames, fields, relationships } = this.descriptor;
    const query = this.neo4j.initQuery();

    // Validate related nodes exist
    const nodesToValidate: Array<{ id: string; label: string }> = [];
    for (const [name, rel] of Object.entries(relationships)) {
      if (rel.immutable) continue;

      const paramValue = params[name];
      if (paramValue) {
        const ids = Array.isArray(paramValue) ? paramValue : [paramValue];
        nodesToValidate.push(...ids.map((id) => ({ id, label: rel.model.labelName })));
      }
    }

    if (nodesToValidate.length > 0) {
      await this.neo4j.validateExistingNodes({ nodes: nodesToValidate.filter(Boolean) });
    }

    // Build query parameters
    query.queryParams = {
      ...query.queryParams,
      ...params,
    };

    // Build SET assignments for all fields with proper Cypher type casting
    const setAssignments = fieldNames
      .map((fieldName) => {
        const fieldDef = fields[fieldName as keyof typeof fields];
        const fieldType = fieldDef?.type;
        if (fieldType === "datetime") {
          return `${nodeName}.${fieldName} = datetime($${fieldName})`;
        } else if (fieldType === "date") {
          return `${nodeName}.${fieldName} = date(left($${fieldName}, 10))`;
        } else if (fieldType === "datetime[]") {
          return `${nodeName}.${fieldName} = [x IN $${fieldName} | datetime(x)]`;
        } else if (fieldType === "date[]") {
          return `${nodeName}.${fieldName} = [x IN $${fieldName} | date(left(x, 10))]`;
        }
        return `${nodeName}.${fieldName} = $${fieldName}`;
      })
      .join(", ");

    // Update node with fields from descriptor
    // For generic entities, match without company relationship
    const matchClause = this.descriptor.isCompanyScoped
      ? `MATCH (${nodeName}:${labelName} {id: $id})-[:BELONGS_TO]->(company)`
      : `MATCH (${nodeName}:${labelName} {id: $id})`;

    query.query += `
      ${matchClause}
      SET ${nodeName}.updatedAt = datetime()${setAssignments ? `, ${setAssignments}` : ""}
    `;

    // Update relationships
    for (const [name, rel] of Object.entries(relationships)) {
      // Skip company relationship if isCompanyScoped - it's managed automatically
      if (this.descriptor.isCompanyScoped && rel.relationship === "BELONGS_TO" && rel.model.labelName === "Company") {
        continue;
      }

      // Skip immutable relationships - they are preserved as-is during PUT
      if (rel.immutable) continue;

      const paramValue = params[name];
      // Add param to query params
      query.queryParams[name] = paramValue ? (Array.isArray(paramValue) ? paramValue : [paramValue]) : [];

      // Build relationship properties resolver if relationship has fields
      let relationshipProperties: ((id: string) => Record<string, any>) | undefined;
      if (rel.fields && rel.fields.length > 0 && paramValue) {
        const edgePropsMap = params[`${name}EdgeProps`];

        if (edgePropsMap) {
          // MANY relationship: use per-item edge properties map
          relationshipProperties = (id: string) => edgePropsMap[id] || {};
        } else {
          // SINGLE relationship: all edges get same props (existing behavior)
          relationshipProperties = (_id: string) => {
            const props: Record<string, any> = {};
            for (const field of rel.fields!) {
              if (params[field.name] !== undefined) {
                props[field.name] = params[field.name];
              }
            }
            return props;
          };
        }
      }

      query.query += updateRelationshipQuery({
        node: nodeName,
        relationshipName: rel.relationship,
        relationshipToNode: rel.direction === "out",
        label: rel.model.labelName,
        param: name,
        values: paramValue ? (Array.isArray(paramValue) ? paramValue : [paramValue]) : [],
        relationshipProperties,
        queryParams: query.queryParams,
      });
    }

    await this.neo4j.writeOne(query);
  }

  /**
   * Partial update - only updates fields and relationships that are explicitly passed
   * Unlike put(), this method only modifies properties present in params
   */
  async patch(params: { id: string; [key: string]: any }): Promise<void> {
    const { nodeName, labelName } = this.descriptor.model;
    const { fieldNames, fields, relationships } = this.descriptor;
    const query = this.neo4j.initQuery();

    // Determine which fields to update (only those in params AND in fieldNames)
    const fieldsToUpdate = fieldNames.filter((field) => params[field] !== undefined);

    // Determine which relationships to update (only those in params)
    const relationshipsToUpdate = Object.entries(relationships).filter(([name]) => params[name] !== undefined);

    // Validate related nodes exist
    const nodesToValidate: Array<{ id: string; label: string }> = [];
    for (const [name, rel] of relationshipsToUpdate) {
      const paramValue = params[name];
      if (paramValue) {
        const ids = Array.isArray(paramValue) ? paramValue : [paramValue];
        nodesToValidate.push(...ids.map((id) => ({ id, label: rel.model.labelName })));
      }
    }

    if (nodesToValidate.length > 0) {
      await this.neo4j.validateExistingNodes({ nodes: nodesToValidate.filter(Boolean) });
    }

    // Build query parameters (only include fields that are being updated)
    query.queryParams = {
      ...query.queryParams,
      id: params.id,
    };

    for (const field of fieldsToUpdate) {
      query.queryParams[field] = params[field];
    }

    for (const [name] of relationshipsToUpdate) {
      const paramValue = params[name];
      query.queryParams[name] = paramValue ? (Array.isArray(paramValue) ? paramValue : [paramValue]) : [];
    }

    // Build SET assignments only for fields present in params with proper Cypher type casting
    const setAssignments = fieldsToUpdate
      .map((fieldName) => {
        const fieldDef = fields[fieldName as keyof typeof fields];
        const fieldType = fieldDef?.type;
        if (fieldType === "datetime") {
          return `${nodeName}.${fieldName} = datetime($${fieldName})`;
        } else if (fieldType === "date") {
          return `${nodeName}.${fieldName} = date(left($${fieldName}, 10))`;
        } else if (fieldType === "datetime[]") {
          return `${nodeName}.${fieldName} = [x IN $${fieldName} | datetime(x)]`;
        } else if (fieldType === "date[]") {
          return `${nodeName}.${fieldName} = [x IN $${fieldName} | date(left(x, 10))]`;
        }
        return `${nodeName}.${fieldName} = $${fieldName}`;
      })
      .join(", ");

    // Update node with only the provided fields
    // For generic entities, match without company relationship
    const matchClause = this.descriptor.isCompanyScoped
      ? `MATCH (${nodeName}:${labelName} {id: $id})-[:BELONGS_TO]->(company)`
      : `MATCH (${nodeName}:${labelName} {id: $id})`;

    query.query += `
      ${matchClause}
      SET ${nodeName}.updatedAt = datetime()${setAssignments ? `, ${setAssignments}` : ""}
    `;

    // Update only the relationships that were passed
    for (const [name, rel] of relationshipsToUpdate) {
      const paramValue = params[name];

      // Build relationship properties resolver if relationship has fields
      let relationshipProperties: ((id: string) => Record<string, any>) | undefined;
      if (rel.fields && rel.fields.length > 0 && paramValue) {
        const edgePropsMap = params[`${name}EdgeProps`];

        if (edgePropsMap) {
          // MANY relationship: use per-item edge properties map
          relationshipProperties = (id: string) => edgePropsMap[id] || {};
        } else {
          // SINGLE relationship: all edges get same props (existing behavior)
          relationshipProperties = (_id: string) => {
            const props: Record<string, any> = {};
            for (const field of rel.fields!) {
              if (params[field.name] !== undefined) {
                props[field.name] = params[field.name];
              }
            }
            return props;
          };
        }
      }

      query.query += updateRelationshipQuery({
        node: nodeName,
        relationshipName: rel.relationship,
        relationshipToNode: rel.direction === "out",
        label: rel.model.labelName,
        param: name,
        values: paramValue ? (Array.isArray(paramValue) ? paramValue : [paramValue]) : [],
        relationshipProperties,
        queryParams: query.queryParams,
      });
    }

    // Handle edge-only updates (update edge properties without changing linked items)
    for (const [name, rel] of Object.entries(relationships)) {
      const edgePropsUpdate = params[`${name}EdgePropsUpdate`];
      if (edgePropsUpdate && rel.fields && rel.fields.length > 0) {
        query.queryParams[`${name}EdgePropsMap`] = edgePropsUpdate;
        const edgePropsFields = rel.fields.map((f) => `rel.${f.name} = $${name}EdgePropsMap[relatedId].${f.name}`);
        query.query += `
          WITH ${nodeName}
          UNWIND keys($${name}EdgePropsMap) AS relatedId
          MATCH (${nodeName})${rel.direction === "out" ? "-" : "<-"}[rel:${rel.relationship}]${rel.direction === "out" ? "->" : "-"}(related:${rel.model.labelName} {id: relatedId})
          SET ${edgePropsFields.join(", ")}, rel.updatedAt = datetime()
        `;
      }
    }

    await this.neo4j.writeOne(query);
  }

  /**
   * Delete an entity and all its relationships
   */
  async delete(params: { id: string }): Promise<void> {
    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
    };

    // For generic entities, match without company relationship
    const matchClause = this.descriptor.isCompanyScoped
      ? `MATCH (${nodeName}:${labelName} {id: $id})-[:BELONGS_TO]->(company)`
      : `MATCH (${nodeName}:${labelName} {id: $id})`;

    query.query += `
      ${matchClause}
      DETACH DELETE ${nodeName};
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Add items to a to-many relationship
   *
   * @param id - The parent entity ID
   * @param relationship - The relationship key (must match a key in descriptor.relationships)
   * @param items - Array of items to add with optional edge properties
   */
  async addToRelationship(params: {
    id: string;
    relationship: keyof R & string;
    items: { id: string; edgeProps?: Record<string, any> }[];
  }): Promise<void> {
    if (params.items.length === 0) return;

    const { labelName } = this.descriptor.model;
    const rel = this.descriptor.relationships[params.relationship];

    if (!rel) {
      throw new HttpException(`Unknown relationship: ${params.relationship}`, HttpStatus.BAD_REQUEST);
    }

    if (rel.cardinality !== "many") {
      throw new HttpException(
        `addToRelationship only works with 'many' cardinality relationships`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const query = this.neo4j.initQuery();

    // Build items array with edge properties
    const itemsWithProps = params.items.map((item) => ({
      id: item.id,
      edgeProps: item.edgeProps || {},
    }));

    query.queryParams = {
      ...query.queryParams,
      parentId: params.id,
      items: itemsWithProps,
    };

    // Match pattern based on direction
    const matchClause = this.descriptor.isCompanyScoped
      ? `MATCH (parent:${labelName} {id: $parentId})-[:BELONGS_TO]->(company)`
      : `MATCH (parent:${labelName} {id: $parentId})`;

    const relPattern = rel.direction === "out" ? `-[r:${rel.relationship}]->` : `<-[r:${rel.relationship}]-`;

    // Build SET clause for edge properties if the relationship has fields
    let setClause = "";
    if (rel.fields && rel.fields.length > 0) {
      const fieldSets = rel.fields.map((f) => `r.${f.name} = item.edgeProps.${f.name}`);
      setClause = `SET ${fieldSets.join(", ")}, r.createdAt = COALESCE(r.createdAt, datetime()), r.updatedAt = datetime()`;
    } else {
      setClause = `SET r.createdAt = COALESCE(r.createdAt, datetime()), r.updatedAt = datetime()`;
    }

    // Build query: UNWIND items, match related entity, MERGE relationship
    query.query += `
      ${matchClause}
      UNWIND $items AS item
      MATCH (related:${rel.model.labelName} {id: item.id})${this.descriptor.isCompanyScoped ? "-[:BELONGS_TO]->(company)" : ""}
      MERGE (parent)${relPattern}(related)
      ${setClause}
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Remove items from a to-many relationship
   *
   * @param id - The parent entity ID
   * @param relationship - The relationship key (must match a key in descriptor.relationships)
   * @param itemIds - Array of item IDs to remove from the relationship
   */
  async removeFromRelationship(params: {
    id: string;
    relationship: keyof R & string;
    itemIds: string[];
  }): Promise<void> {
    if (params.itemIds.length === 0) return;

    const { labelName } = this.descriptor.model;
    const rel = this.descriptor.relationships[params.relationship];

    if (!rel) {
      throw new HttpException(`Unknown relationship: ${params.relationship}`, HttpStatus.BAD_REQUEST);
    }

    if (rel.cardinality !== "many") {
      throw new HttpException(
        `removeFromRelationship only works with 'many' cardinality relationships`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      parentId: params.id,
      itemIds: params.itemIds,
    };

    // Match pattern based on direction
    const matchClause = this.descriptor.isCompanyScoped
      ? `MATCH (parent:${labelName} {id: $parentId})-[:BELONGS_TO]->(company)`
      : `MATCH (parent:${labelName} {id: $parentId})`;

    const relPattern = rel.direction === "out" ? `-[r:${rel.relationship}]->` : `<-[r:${rel.relationship}]-`;

    query.query += `
      ${matchClause}
      MATCH (parent)${relPattern}(related:${rel.model.labelName})
      WHERE related.id IN $itemIds
      DELETE r
    `;

    await this.neo4j.writeOne(query);
  }
}
