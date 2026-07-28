import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, CallToolResult, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ConfigMcpInterface } from "../../config/interfaces/config.mcp.interface";
import { McpUserContext } from "../interfaces/mcp.tool.interface";
import { McpToolRegistry } from "./mcp.tool.registry";

/**
 * Builds a per-request, stateless MCP protocol server.
 *
 * Uses the SDK's low-level `Server` (NOT `McpServer`) so tool input schemas
 * stay plain JSON Schema objects produced by the tool layer. Each authenticated
 * request gets its own Server instance bound to that user's context, so
 * tools/list and tools/call are always RBAC-filtered through McpToolRegistry.
 */
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly registry: McpToolRegistry,
  ) {}

  /**
   * Creates a stateless MCP Server for one authenticated request.
   * Registers tools/list (with `annotations.readOnlyHint` derived from each
   * tool's `readOnly` flag) and tools/call (dispatched through the registry).
   */
  create(ctx: McpUserContext): Server {
    const mcp = this.configService.get<ConfigMcpInterface>("mcp");
    const server = new Server(
      { name: mcp?.serverName ?? "neural-erp", version: "1.0.0" },
      { capabilities: { tools: {} }, instructions: mcp?.instructions },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.registry.build(ctx).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as { type: "object"; [key: string]: unknown },
        annotations: { readOnlyHint: tool.readOnly },
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const result = await this.registry.call(
        request.params.name,
        (request.params.arguments ?? {}) as Record<string, unknown>,
        ctx,
      );
      return { content: result.content, ...(result.isError !== undefined ? { isError: result.isError } : {}) };
    });

    return server;
  }
}
