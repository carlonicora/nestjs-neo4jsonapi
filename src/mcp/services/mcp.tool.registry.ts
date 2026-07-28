import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  MCP_TOOLS,
  McpToolContribution,
  McpToolDefinition,
  McpToolResult,
  McpUserContext,
} from "../interfaces/mcp.tool.interface";
import { McpGenericToolsService } from "./mcp.generic.tools.service";
import { McpPromotedToolsFactory } from "./mcp.promoted.tools.factory";

/**
 * Composes the MCP tool set for a single authenticated request:
 * - the generic tools (graph reads, document retrieval, entity writes)
 * - the config-promoted per-entity tools
 * - any app-contributed factories registered under the MCP_TOOLS token,
 *   built per request with the same user context as the built-ins
 */
@Injectable()
export class McpToolRegistry {
  constructor(
    private readonly generic: McpGenericToolsService,
    private readonly promoted: McpPromotedToolsFactory,
    @Optional() @Inject(MCP_TOOLS) private readonly contributed?: McpToolContribution[],
  ) {}

  /** RBAC-filtered tool list for this user; throws on duplicate tool names. */
  build(ctx: McpUserContext): McpToolDefinition[] {
    const tools = [
      ...this.generic.build(ctx),
      ...this.promoted.build(ctx),
      ...(this.contributed ?? []).flatMap((c) => c.build(ctx)),
    ];

    // Guard against name collisions: a contributed tool named like a built-in
    // would otherwise silently shadow it in tools/call dispatch.
    const seen = new Set<string>();
    for (const tool of tools) {
      if (seen.has(tool.name)) {
        throw new Error(
          `McpToolRegistry: duplicate MCP tool name: ${tool.name}. ` +
            `A contributed MCP_TOOLS contribution must not reuse the name of a built-in or another contributed tool.`,
        );
      }
      seen.add(tool.name);
    }
    return tools;
  }

  /** Routes a tools/call to the named tool; unknown names return a flat error payload. */
  async call(name: string, input: Record<string, unknown>, ctx: McpUserContext): Promise<McpToolResult> {
    const tool = this.build(ctx).find((t) => t.name === name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ code: "unknown_type", message: `Unknown tool: ${name}` }) }],
      };
    }
    return tool.execute(input, ctx);
  }
}
