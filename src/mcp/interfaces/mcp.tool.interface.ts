/** Per-request user context every MCP tool executes with (company scoping + RBAC module visibility). */
export interface McpUserContext {
  userId: string;
  companyId: string;
  userModuleIds: string[];
}

/** MCP tool-call result: text content blocks, with `isError` set on failures. */
export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * A single MCP tool as exposed over tools/list + tools/call.
 * `inputSchema` is JSON Schema (draft 2020-12); `readOnly` maps to `annotations.readOnlyHint`.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  execute(input: Record<string, unknown>, ctx: McpUserContext): Promise<McpToolResult>;
}

/**
 * Factory contract for app-contributed MCP tools.
 * Built once per request — like the built-ins — so contributed tools can
 * apply company scoping and RBAC filtering from the request context.
 */
export interface McpToolContribution {
  /** Called once per MCP request with the authenticated user context. */
  build(ctx: McpUserContext): McpToolDefinition[];
}

/** Multi-provider DI token: consuming apps contribute McpToolContribution factories. */
export const MCP_TOOLS = Symbol("MCP_TOOLS");
