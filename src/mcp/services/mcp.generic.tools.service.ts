import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { GraphCatalogService } from "../../agents/graph/services/graph.catalog.service";
import { ConfigMcpInterface } from "../../config/interfaces/config.mcp.interface";
import { DescribeEntityTool, describeEntityInputSchema } from "../../agents/graph/tools/describe-entity.tool";
import { ReadEntityTool, readEntityInputSchema } from "../../agents/graph/tools/read-entity.tool";
import { ResolveEntityTool, resolveEntityInputSchema } from "../../agents/graph/tools/resolve-entity.tool";
import { SearchEntitiesTool, searchEntitiesInputSchema } from "../../agents/graph/tools/search-entities.tool";
import { ToolCallRecord } from "../../agents/graph/tools/tool.factory";
import {
  coerceFilters,
  coerceSort,
  filtersJsonSchema,
  sortJsonSchema,
  TraverseTool,
  traverseInputSchema,
} from "../../agents/graph/tools/traverse.tool";
import { SearchDocumentsTool, searchDocumentsInputSchema } from "../../agents/operator/tools/search-documents.tool";
import {
  MCP_STATUS,
  McpStatusContribution,
  McpToolDefinition,
  McpToolResult,
  McpUserContext,
} from "../interfaces/mcp.tool.interface";
import { mcpError, mcpFlatError, mcpToolResult } from "./mcp.errors";
import { McpEntityWriteService } from "./mcp.entity.write.service";

// Descriptions copied verbatim from each tool's build() (single source is the
// DynamicStructuredTool literal in the tool file; not exportable without
// restructuring those files beyond the schema-export-only change).
const DESCRIBE_DESCRIPTION = "Returns the described fields and relationships for an entity type.";
//
// Documented divergence (see docs/mcp-server.md): the MCP copies of
// resolve_entity and search_entities do NOT tell the client to call
// resolve_entity first. Over MCP the server instructions (MCP_INSTRUCTIONS)
// decide when resolve_entity is the right tool; the operator copies in
// resolve-entity.tool.ts and search-entities.tool.ts keep the original wording.
const RESOLVE_DESCRIPTION =
  "Resolve a user-named entity across every visible type. Returns ranked candidates from the highest-confidence tier that yielded any match anywhere. Pass types to restrict the search to the record kinds you mean.";
const SEARCH_DESCRIPTION =
  "Find records of a known type by filter and sort. Use this when you already have the type, or to look up a specific record of a known type by its label, number or other identifying field.";
const READ_DESCRIPTION = "Fetches one record by id, optionally pulling related records across described relationships.";
const TRAVERSE_DESCRIPTION =
  "Walks a relationship from a known record to related records, optionally filtered and sorted.";
const SEARCH_DOCS_DESCRIPTION =
  "Search the company's documents (GraphRAG) for information relevant to a question. Returns the retrieved passages, each prefixed by its chunkId.";

const PING_DESCRIPTION =
  "Check the connection: returns the server name and version, the current time, the signed-in user and company, how many record types are visible, and the status the application reports (e.g. corpus coverage, queues). Read only, spends no credits.";

const pingInputSchema = z.object({}).strict();

let packageVersion: string | undefined;

/**
 * This package's own version, read once from its package.json. The path is the
 * same from `src/mcp/services` and `dist/mcp/services`: three levels up is the
 * package root.
 */
function readPackageVersion(): string {
  if (packageVersion === undefined) {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8")) as {
      version?: string;
    };
    packageVersion = pkg.version ?? "unknown";
  }
  return packageVersion;
}

/**
 * The JSON Schema of a list tool's input with the explicit `filters` and
 * `sort` shapes. The Zod schemas type both as `z.any()` (the coercion owns the
 * contract), which converts to `{}` and tells the client nothing.
 */
function withFilterSchemas(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown> & { properties?: Record<string, unknown> };
  return { ...json, properties: { ...json.properties, filters: filtersJsonSchema, sort: sortJsonSchema } };
}

/**
 * Builds the generic MCP tool set for one authenticated request:
 * the five graph read tools, the document-retrieval tool, `ping`, and the four
 * entity write tools contributed by McpEntityWriteService (only when the
 * user's catalog has a `chat.writable` type).
 */
@Injectable()
export class McpGenericToolsService {
  constructor(
    private readonly resolveEntityTool: ResolveEntityTool,
    private readonly describeEntityTool: DescribeEntityTool,
    private readonly searchEntitiesTool: SearchEntitiesTool,
    private readonly readEntityTool: ReadEntityTool,
    private readonly traverseTool: TraverseTool,
    private readonly searchDocumentsTool: SearchDocumentsTool,
    private readonly writeService: McpEntityWriteService,
    private readonly catalog: GraphCatalogService,
    private readonly configService: ConfigService,
    @Optional() @Inject(MCP_STATUS) private readonly statusContributions: McpStatusContribution[] = [],
  ) {}

  /**
   * The `ping` reply: identity of the server and the caller, the visible
   * catalog size, and every app status contribution merged at the top level.
   */
  async ping(ctx: McpUserContext): Promise<Record<string, unknown>> {
    const contributed = await Promise.all((this.statusContributions ?? []).map((c) => c.status(ctx)));
    return {
      server: this.configService.get<ConfigMcpInterface>("mcp")?.serverName ?? "neural-erp",
      version: readPackageVersion(),
      now: new Date().toISOString(),
      user: { userId: ctx.userId, companyId: ctx.companyId },
      catalog: { types: this.catalog.getAccessibleTypes(ctx.userModuleIds).length },
      ...Object.assign({}, ...contributed),
    };
  }

  /**
   * Builds the per-request generic tool definitions: the read tools, plus the
   * write tools when {@link McpEntityWriteService.hasWritableTypes} is true.
   */
  build(ctx: McpUserContext): McpToolDefinition[] {
    const recorder: ToolCallRecord[] = [];
    // The graph tools enforce a describe-first contract via the recorder. That
    // works in the operator, where one recorder spans a whole LangGraph turn —
    // but MCP is stateless: every tools/call gets a fresh recorder, so a prior
    // describe_entity call can never be seen and the contract would loop
    // forever. Seed the recorder with the requested type instead (same
    // approach as McpPromotedToolsFactory); the schema stays discoverable
    // through the describe_entity MCP tool itself.
    const seedDescribe = (type: unknown): void => {
      if (typeof type === "string" && type.length > 0) {
        recorder.push({ tool: "describe_entity", input: { type }, durationMs: 0 });
      }
    };
    const read = (
      name: string,
      description: string,
      schema: z.ZodType,
      invoke: (input: any) => Promise<unknown>,
      seedType?: (parsed: any) => unknown,
      filtered?: boolean,
    ): McpToolDefinition => ({
      name,
      description,
      inputSchema: filtered ? withFilterSchemas(schema) : (z.toJSONSchema(schema) as Record<string, unknown>),
      readOnly: true,
      execute: async (input): Promise<McpToolResult> => {
        try {
          const parsed = schema.parse(input);
          // A filter or sort the tool cannot apply is a client error, not a
          // result: the MCP client must see isError, never an unfiltered or
          // differently ordered list. An unknown key fails schema.parse (both
          // list schemas are strict) and maps to validation_failed.
          if (filtered) {
            const coerced = coerceFilters((parsed as { filters?: unknown }).filters);
            if ("error" in coerced) {
              return mcpFlatError("validation_failed", coerced.error, { filters: filtersJsonSchema });
            }
            const coercedSort = coerceSort((parsed as { sort?: unknown }).sort);
            if ("error" in coercedSort) {
              return mcpFlatError("validation_failed", coercedSort.error, { sort: sortJsonSchema });
            }
          }
          if (seedType) seedDescribe(seedType(parsed));
          // A tool-level `{ error }` value is a failed call: isError, never success.
          return mcpToolResult(await invoke(parsed));
        } catch (e) {
          return mcpError(e);
        }
      },
    });
    return [
      read("describe_entity", DESCRIBE_DESCRIPTION, describeEntityInputSchema, (i) =>
        this.describeEntityTool.invoke(i, ctx, recorder),
      ),
      read("resolve_entity", RESOLVE_DESCRIPTION, resolveEntityInputSchema, (i) =>
        this.resolveEntityTool.invoke(i, ctx, recorder),
      ),
      read(
        "search_entities",
        SEARCH_DESCRIPTION,
        searchEntitiesInputSchema,
        (i) => this.searchEntitiesTool.invoke(i, ctx, recorder),
        (parsed) => parsed.type,
        true,
      ),
      read(
        "read_entity",
        READ_DESCRIPTION,
        readEntityInputSchema,
        (i) => this.readEntityTool.invoke(i, ctx, recorder),
        (parsed) => parsed.type,
      ),
      read(
        "traverse",
        TRAVERSE_DESCRIPTION,
        traverseInputSchema,
        (i) => this.traverseTool.invoke(i, ctx, recorder),
        (parsed) => parsed.fromType,
        true,
      ),
      read("search_documents", SEARCH_DOCS_DESCRIPTION, searchDocumentsInputSchema, (i) =>
        // SearchDocumentsTool needs an OperatorRetrievalContext; MCP has no
        // conversation, so dataLimits defaults to {} (all fields optional)
        // and messages to [] — the documented fallback.
        this.searchDocumentsTool.invoke(i, { ...ctx, dataLimits: {}, messages: [] }, recorder),
      ),
      {
        name: "ping",
        description: PING_DESCRIPTION,
        inputSchema: z.toJSONSchema(pingInputSchema) as Record<string, unknown>,
        readOnly: true,
        gateFree: true,
        execute: async (input): Promise<McpToolResult> => {
          try {
            pingInputSchema.parse(input ?? {});
            return { content: [{ type: "text", text: JSON.stringify(await this.ping(ctx)) }] };
          } catch (e) {
            return mcpError(e);
          }
        },
      },
      // The generic write tools are listed only when the user's catalog has a
      // chat.writable type: without one every call would answer not_writable,
      // and a server whose data is read-only must not advertise writes.
      ...(this.writeService.hasWritableTypes(ctx) ? this.writeService.buildTools(ctx) : []),
    ];
  }
}
