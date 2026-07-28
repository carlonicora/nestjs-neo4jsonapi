import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CatalogEntity } from "../../agents/graph/interfaces/graph.catalog.interface";
import { GraphCatalogService } from "../../agents/graph/services/graph.catalog.service";
import { EntityServiceRegistry } from "../../common/registries/entity.service.registry";
import type { JsonApiDTOData } from "../../core/neo4j/abstracts/abstract.service";
import { RbacPermissionService } from "../../foundations/rbac/services/rbac-permission.service";
import type { McpToolDefinition, McpToolResult, McpUserContext } from "../interfaces/mcp.tool.interface";
import { mcpError, mcpFlatError } from "./mcp.errors";

const UPDATE_SEMANTICS =
  "Partial update: only the attributes you provide are changed; omitted attributes and all relationships are left untouched. Use add_relationship/remove_relationship to change relationships.";

/**
 * MCP write executors (C4): create/update entities and add/remove to-many
 * relationship items for any JSON:API type registered in EntityServiceRegistry.
 *
 * Every write is gated by the catalog (type visible to the user's modules) and
 * RBAC (`create`/`update` permission on the entity's module), dispatched through
 * the framework's `AbstractService.*FromDTO` path (never hand-built JSON:API
 * beyond the `JsonApiDTOData` framework type). Audit is NOT performed here:
 * `AbstractService.create/put` audits internally when the concrete entity
 * service injects AuditService, so MCP writes audit exactly like HTTP writes.
 */
@Injectable()
export class McpEntityWriteService {
  constructor(
    private readonly registry: EntityServiceRegistry,
    private readonly catalog: GraphCatalogService,
    private readonly rbac: RbacPermissionService,
  ) {}

  /**
   * The four write McpToolDefinitions (all `readOnly: false`) with hand-written
   * JSON Schemas matching the C4 method params. Consumed by McpGenericToolsService.
   */
  buildTools(_ctx: McpUserContext): McpToolDefinition[] {
    const typeProperty = {
      type: "string",
      description: 'JSON:API entity type (plural, e.g. "orders"). Call describe_entity first for the field list.',
    };
    const idProperty = { type: "string", description: "The id of the target record." };
    return [
      {
        name: "create_entity",
        description:
          "Create a new record of the given JSON:API entity type. " +
          "Call describe_entity first to learn the valid attributes and relationships.",
        inputSchema: {
          type: "object",
          properties: {
            type: typeProperty,
            attributes: {
              type: "object",
              description: "Attribute values keyed by field name (see describe_entity).",
            },
            relationships: {
              type: "object",
              description: "Optional JSON:API relationships keyed by relationship name.",
              additionalProperties: {
                type: "object",
                properties: {
                  data: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { type: { type: "string" }, id: { type: "string" } },
                      required: ["type", "id"],
                    },
                  },
                },
                required: ["data"],
              },
            },
          },
          required: ["type", "attributes"],
        },
        readOnly: false,
        execute: (input, ctx) =>
          this.createEntity(
            input as {
              type: string;
              attributes: Record<string, unknown>;
              relationships?: Record<string, { data: Array<{ type: string; id: string }> }>;
            },
            ctx,
          ),
      },
      {
        name: "update_entity",
        description: `Update an existing record. ${UPDATE_SEMANTICS}`,
        inputSchema: {
          type: "object",
          properties: {
            type: typeProperty,
            id: idProperty,
            attributes: {
              type: "object",
              description: `The attribute values to change. ${UPDATE_SEMANTICS}`,
            },
          },
          required: ["type", "id", "attributes"],
        },
        readOnly: false,
        execute: (input, ctx) =>
          this.updateEntity(input as { type: string; id: string; attributes: Record<string, unknown> }, ctx),
      },
      {
        name: "add_relationship",
        description:
          "Add one or more related records to a to-many relationship of an existing record. " +
          "Call describe_entity first for the relationship names.",
        inputSchema: {
          type: "object",
          properties: {
            type: typeProperty,
            id: idProperty,
            relationship: { type: "string", description: "Relationship name on the entity (see describe_entity)." },
            relatedType: { type: "string", description: "JSON:API type of the related records." },
            relatedIds: { type: "array", items: { type: "string" }, minItems: 1 },
          },
          required: ["type", "id", "relationship", "relatedType", "relatedIds"],
        },
        readOnly: false,
        execute: (input, ctx) =>
          this.addRelationship(
            input as { type: string; id: string; relationship: string; relatedType: string; relatedIds: string[] },
            ctx,
          ),
      },
      {
        name: "remove_relationship",
        description: "Remove one or more related records from a to-many relationship of an existing record.",
        inputSchema: {
          type: "object",
          properties: {
            type: typeProperty,
            id: idProperty,
            relationship: { type: "string", description: "Relationship name on the entity (see describe_entity)." },
            relatedType: { type: "string", description: "JSON:API type of the related records." },
            relatedIds: { type: "array", items: { type: "string" }, minItems: 1 },
          },
          required: ["type", "id", "relationship", "relatedType", "relatedIds"],
        },
        readOnly: false,
        execute: (input, ctx) =>
          this.removeRelationship(
            input as { type: string; id: string; relationship: string; relatedType: string; relatedIds: string[] },
            ctx,
          ),
      },
    ];
  }

  /** Create a new entity of the given type. RBAC action: `create`. */
  async createEntity(
    params: {
      type: string;
      attributes: Record<string, unknown>;
      relationships?: Record<string, { data: Array<{ type: string; id: string }> }>;
    },
    ctx: McpUserContext,
  ): Promise<McpToolResult> {
    const gate = await this.gate(params.type, "create", ctx);
    if ("error" in gate) return gate.error;
    const { entity, service } = gate;
    const invalid = this.unknownAttributes(entity, params.attributes);
    if (invalid) return invalid;
    try {
      const data: JsonApiDTOData = {
        id: randomUUID(),
        type: params.type,
        attributes: params.attributes,
        ...(params.relationships ? { relationships: params.relationships } : {}),
      };
      const result = await service.createFromDTO({ data });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      return mcpError(e);
    }
  }

  /**
   * Update an existing entity. RBAC action: `update`.
   *
   * PATCH semantics via `patchFromDTO` — only the provided attributes change.
   * Deliberately NOT `putFromDTO`: the framework's PUT maps every descriptor
   * relationship and treats the ones absent from the DTO as "delete all
   * edges". The HTTP path is safe because the frontend model always sends the
   * complete relationship set on PUT, but an MCP caller sends attributes only —
   * a PUT here would silently strip every mutable relationship off the record.
   */
  async updateEntity(
    params: { type: string; id: string; attributes: Record<string, unknown> },
    ctx: McpUserContext,
  ): Promise<McpToolResult> {
    const gate = await this.gate(params.type, "update", ctx);
    if ("error" in gate) return gate.error;
    const { entity, service } = gate;
    const invalid = this.unknownAttributes(entity, params.attributes);
    if (invalid) return invalid;
    try {
      const before = await service.findRecordById({ id: params.id });
      if (!before) return mcpFlatError("not_found", `No ${params.type} record with id ${params.id}.`);
      const data: JsonApiDTOData = { id: params.id, type: params.type, attributes: params.attributes };
      const result = await service.patchFromDTO({ data });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      return mcpError(e);
    }
  }

  /** Add items to a to-many relationship. RBAC action: `update`. */
  async addRelationship(
    params: { type: string; id: string; relationship: string; relatedType: string; relatedIds: string[] },
    ctx: McpUserContext,
  ): Promise<McpToolResult> {
    const gate = await this.gate(params.type, "update", ctx);
    if ("error" in gate) return gate.error;
    const { service } = gate;
    try {
      const data = params.relatedIds.map((id) => ({ type: params.relatedType, id }));
      const result = await service.addToRelationshipFromDTO({
        id: params.id,
        relationship: params.relationship,
        data,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      return mcpError(e);
    }
  }

  /** Remove items from a to-many relationship. RBAC action: `update`. */
  async removeRelationship(
    params: { type: string; id: string; relationship: string; relatedType: string; relatedIds: string[] },
    ctx: McpUserContext,
  ): Promise<McpToolResult> {
    const gate = await this.gate(params.type, "update", ctx);
    if ("error" in gate) return gate.error;
    const { service } = gate;
    try {
      const data = params.relatedIds.map((id) => ({ type: params.relatedType, id }));
      const result = await service.removeFromRelationshipFromDTO({
        id: params.id,
        relationship: params.relationship,
        data,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      return mcpError(e);
    }
  }

  /**
   * Shared gate: catalog visibility (unknown_type), RBAC (forbidden), and
   * service registration (unknown_type).
   */
  private async gate(
    type: string,
    action: "create" | "update",
    ctx: McpUserContext,
  ): Promise<
    { entity: CatalogEntity; service: NonNullable<ReturnType<EntityServiceRegistry["get"]>> } | { error: McpToolResult }
  > {
    const entity = this.catalog.getEntityDetail(type, ctx.userModuleIds);
    if (!entity) {
      return {
        error: mcpFlatError(
          "unknown_type",
          `Unknown or inaccessible entity type: ${type}. Call describe_entity first.`,
        ),
      };
    }
    if (!(await this.rbac.can({ userId: ctx.userId, moduleId: entity.moduleId, action }))) {
      return { error: mcpFlatError("forbidden", `You lack ${action} permission on ${type}.`) };
    }
    const service = this.registry.get(type);
    if (!service) {
      return { error: mcpFlatError("unknown_type", `No service registered for ${type}.`) };
    }
    return { entity, service };
  }

  /**
   * Rejects attribute keys that are not in the entity's catalog field list.
   * Catalog fields are a CatalogField[] array — keys are the `name` property.
   */
  private unknownAttributes(entity: CatalogEntity, attributes: Record<string, unknown>): McpToolResult | null {
    const known = new Set(entity.fields.map((f) => f.name));
    const unknown = Object.keys(attributes).filter((k) => !known.has(k));
    if (unknown.length) {
      return mcpFlatError(
        "validation_failed",
        `Unknown attributes: ${unknown.join(", ")}. Call describe_entity("${entity.type}") for the field list.`,
      );
    }
    return null;
  }
}
