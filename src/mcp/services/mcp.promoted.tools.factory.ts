import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CatalogEntity } from "../../agents/graph/interfaces/graph.catalog.interface";
import { GraphCatalogService } from "../../agents/graph/services/graph.catalog.service";
import { ReadEntityTool } from "../../agents/graph/tools/read-entity.tool";
import { SearchEntitiesTool } from "../../agents/graph/tools/search-entities.tool";
import type { ToolCallRecord } from "../../agents/graph/tools/tool.factory";
import type { ConfigMcpInterface } from "../../config/interfaces/config.mcp.interface";
import type { McpToolDefinition, McpToolResult, McpUserContext } from "../interfaces/mcp.tool.interface";
import { McpEntityWriteService } from "./mcp.entity.write.service";

/**
 * Maps an entity-descriptor field (as exposed by the graph catalog) to a JSON
 * Schema property for MCP tool input schemas.
 *
 * Date and datetime fields are advertised as ISO strings on the wire
 * (`format: "date"` / `format: "date-time"`); storage stays native Neo4j
 * `Date`/`DateTime` because writes flow through the standard
 * `AbstractService.createFromDTO`/`putFromDTO` path, which auto-casts —
 * no custom Cypher is involved.
 *
 * Unknown descriptor types fall back to `{ type: "string" }`. The field's
 * catalog description is carried through when present.
 */
export function descriptorFieldToJsonSchema(field: { type: string; description?: string }): Record<string, unknown> {
  let base: Record<string, unknown>;
  switch (field.type) {
    case "string":
      base = { type: "string" };
      break;
    case "number":
      base = { type: "number" };
      break;
    case "boolean":
      base = { type: "boolean" };
      break;
    case "date":
      base = { type: "string", format: "date" };
      break;
    case "datetime":
      base = { type: "string", format: "date-time" };
      break;
    default:
      base = { type: "string" };
      break;
  }
  return field.description ? { ...base, description: field.description } : base;
}

/**
 * Generates dedicated per-entity MCP tools (`search_<type>`, `get_<type>`,
 * `create_<type>`, `update_<type>`) for every JSON:API type listed in
 * `ConfigMcpInterface.promotedEntities`.
 *
 * Types the user cannot access (unknown type or module not granted) are
 * skipped: `GraphCatalogService.getEntityDetail` returns `null` for both
 * cases. Read tools delegate straight to the graph tool classes with the
 * `type` pre-bound; write tools delegate to {@link McpEntityWriteService},
 * which enforces RBAC and attribute validation.
 */
@Injectable()
export class McpPromotedToolsFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly catalog: GraphCatalogService,
    private readonly searchTool: SearchEntitiesTool,
    private readonly readTool: ReadEntityTool,
    private readonly writeService: McpEntityWriteService,
  ) {}

  /**
   * Builds the promoted per-entity tool definitions for the given user
   * context. Returns an empty array when no promoted entities are configured
   * or none are accessible.
   */
  build(ctx: McpUserContext): McpToolDefinition[] {
    const promotedEntities = this.config.get<ConfigMcpInterface>("mcp")?.promotedEntities ?? [];
    if (!promotedEntities.length) return [];

    // Shared per-build recorder, pre-seeded with a describe_entity record per
    // promoted type: the graph tools refuse to run before describe_entity has
    // been called, but promoted tools embed the schema in their own
    // inputSchema, so the describe requirement is satisfied by construction.
    const recorder: ToolCallRecord[] = [];
    const tools: McpToolDefinition[] = [];

    for (const type of promotedEntities) {
      const entity = this.catalog.getEntityDetail(type, ctx.userModuleIds);
      if (!entity) continue;
      recorder.push({ tool: "describe_entity", input: { type: entity.type }, durationMs: 0 });
      tools.push(
        this.buildSearchTool(entity, ctx, recorder),
        this.buildGetTool(entity, ctx, recorder),
        this.buildCreateTool(entity, ctx),
        this.buildUpdateTool(entity, ctx),
      );
    }
    return tools;
  }

  private buildSearchTool(entity: CatalogEntity, ctx: McpUserContext, recorder: ToolCallRecord[]): McpToolDefinition {
    const filterableFields = entity.fields.filter((f) => f.filterable).map((f) => f.name);
    const sortableFields = entity.fields.filter((f) => f.sortable).map((f) => f.name);
    return {
      name: `search_${entity.type}`,
      description: `Find ${entity.type} records by filter and sort.${this.entityBlurb(entity)}`,
      inputSchema: {
        type: "object",
        properties: {
          filters: {
            description: `Optional filter array: [{ field, op, value }]. Filterable fields: [${filterableFields.join(", ")}]. Operators: eq, ne, in, like (strings), gt, gte, lt, lte (numbers/dates), isNull, isNotNull.`,
          },
          sort: {
            description: `Optional sort array: [{ field, direction: "asc" | "desc" }]. Sortable fields: [${sortableFields.join(", ")}].`,
          },
          limit: {
            type: "integer",
            description: "Maximum number of records to return (default 10, max 50).",
          },
        },
        additionalProperties: false,
      },
      readOnly: true,
      execute: async (input) => {
        try {
          const result = await this.searchTool.invoke({ ...input, type: entity.type } as any, ctx, recorder);
          return this.textResult(result);
        } catch (e) {
          return this.internalError(e);
        }
      },
    };
  }

  private buildGetTool(entity: CatalogEntity, ctx: McpUserContext, recorder: ToolCallRecord[]): McpToolDefinition {
    const relationshipNames = entity.relationships.map((r) => r.name);
    return {
      name: `get_${entity.type}`,
      description: `Fetch one ${entity.type} record by id, optionally pulling one-hop related records.${this.entityBlurb(entity)}`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: `The id of the ${entity.type} record.` },
          include: {
            type: "array",
            items: { type: "string" },
            description: `Relationship names to pull one-hop related records. Available: [${relationshipNames.join(", ")}].`,
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      readOnly: true,
      execute: async (input) => {
        try {
          const result = await this.readTool.invoke({ ...input, type: entity.type } as any, ctx, recorder);
          return this.textResult(result);
        } catch (e) {
          return this.internalError(e);
        }
      },
    };
  }

  private buildCreateTool(entity: CatalogEntity, ctx: McpUserContext): McpToolDefinition {
    const relationshipNames = entity.relationships.map((r) => r.name);
    return {
      name: `create_${entity.type}`,
      description: `Create a new ${entity.type} record.${this.entityBlurb(entity)} All attributes are optional in the schema; call describe_entity("${entity.type}") for field semantics.`,
      inputSchema: {
        type: "object",
        properties: {
          attributes: this.buildAttributesSchema(entity),
          relationships: this.buildRelationshipsSchema(relationshipNames),
        },
        required: ["attributes"],
        additionalProperties: false,
      },
      readOnly: false,
      execute: async (input) => {
        try {
          return await this.writeService.createEntity({ ...input, type: entity.type } as any, ctx);
        } catch (e) {
          return this.internalError(e);
        }
      },
    };
  }

  private buildUpdateTool(entity: CatalogEntity, ctx: McpUserContext): McpToolDefinition {
    return {
      name: `update_${entity.type}`,
      description: `Update a ${entity.type} record by id.${this.entityBlurb(entity)} PUT semantics: replaces all attributes. Read the record first and send every field back.`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: `The id of the ${entity.type} record to update.` },
          attributes: this.buildAttributesSchema(entity),
        },
        required: ["id", "attributes"],
        additionalProperties: false,
      },
      readOnly: false,
      execute: async (input) => {
        try {
          return await this.writeService.updateEntity({ ...input, type: entity.type } as any, ctx);
        } catch (e) {
          return this.internalError(e);
        }
      },
    };
  }

  private buildAttributesSchema(entity: CatalogEntity): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const field of entity.fields) {
      properties[field.name] = descriptorFieldToJsonSchema(field);
    }
    return { type: "object", properties, additionalProperties: false };
  }

  private buildRelationshipsSchema(relationshipNames: string[]): Record<string, unknown> {
    return {
      type: "object",
      description: `Optional relationships keyed by name. Available: [${relationshipNames.join(", ")}]. Each value is { data: [{ type, id }] }.`,
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
    };
  }

  private entityBlurb(entity: CatalogEntity): string {
    return entity.description ? ` ${entity.description}.` : "";
  }

  private textResult(result: unknown): McpToolResult {
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }

  private internalError(e: unknown): McpToolResult {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "internal", message }) }] };
  }
}
