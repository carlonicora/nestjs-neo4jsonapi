import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DescribeEntityTool, describeEntityInputSchema } from "../../agents/graph/tools/describe-entity.tool";
import { ReadEntityTool, readEntityInputSchema } from "../../agents/graph/tools/read-entity.tool";
import { ResolveEntityTool, resolveEntityInputSchema } from "../../agents/graph/tools/resolve-entity.tool";
import { SearchEntitiesTool, searchEntitiesInputSchema } from "../../agents/graph/tools/search-entities.tool";
import { ToolCallRecord } from "../../agents/graph/tools/tool.factory";
import { TraverseTool, traverseInputSchema } from "../../agents/graph/tools/traverse.tool";
import { SearchDocumentsTool, searchDocumentsInputSchema } from "../../agents/operator/tools/search-documents.tool";
import { McpToolDefinition, McpToolResult, McpUserContext } from "../interfaces/mcp.tool.interface";
import { mcpError } from "./mcp.errors";
import { McpEntityWriteService } from "./mcp.entity.write.service";

// Descriptions copied verbatim from each tool's build() (single source is the
// DynamicStructuredTool literal in the tool file; not exportable without
// restructuring those files beyond the schema-export-only change).
const DESCRIBE_DESCRIPTION = "Returns the described fields and relationships for an entity type.";
const RESOLVE_DESCRIPTION =
  "Resolve a user-named entity across every visible type. Returns ranked candidates from the highest-confidence tier that yielded any match anywhere. Use this before search_entities / read_entity / traverse whenever the user refers to a named record.";
const SEARCH_DESCRIPTION =
  "Find records of a known type by filter and sort. Use this when you already have the type (from resolve_entity or because the user referred to a kind of record without identifying a specific one). To look up a specific record by its label, call resolve_entity first.";
const READ_DESCRIPTION = "Fetches one record by id, optionally pulling related records across described relationships.";
const TRAVERSE_DESCRIPTION =
  "Walks a relationship from a known record to related records, optionally filtered and sorted.";
const SEARCH_DOCS_DESCRIPTION =
  "Search the company's documents (GraphRAG) for information relevant to a question. Returns the retrieved passages, each prefixed by its chunkId.";

/**
 * Builds the generic MCP tool set for one authenticated request:
 * the five graph read tools, the document-retrieval tool, and the four
 * entity write tools contributed by McpEntityWriteService.
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
  ) {}

  /** Builds the per-request generic tool definitions (read tools + write tools). */
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
    ): McpToolDefinition => ({
      name,
      description,
      inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
      readOnly: true,
      execute: async (input): Promise<McpToolResult> => {
        try {
          const parsed = schema.parse(input);
          if (seedType) seedDescribe(seedType(parsed));
          const result = await invoke(parsed);
          return {
            content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
          };
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
      ),
      read("search_documents", SEARCH_DOCS_DESCRIPTION, searchDocumentsInputSchema, (i) =>
        // SearchDocumentsTool needs an OperatorRetrievalContext; MCP has no
        // conversation, so dataLimits defaults to {} (all fields optional)
        // and messages to [] — the documented fallback.
        this.searchDocumentsTool.invoke(i, { ...ctx, dataLimits: {}, messages: [] }, recorder),
      ),
      ...this.writeService.buildTools(ctx),
    ];
  }
}
