// MCP (Model Context Protocol) server — public entry point.

// Module (mounted via BootstrapOptions.mcp === true)
export { McpModule } from "./mcp.module";

// App-contribution surface: register McpToolContribution factories under MCP_TOOLS.
export { MCP_TOOLS } from "./interfaces/mcp.tool.interface";
export type {
  McpToolContribution,
  McpToolDefinition,
  McpToolResult,
  McpUserContext,
} from "./interfaces/mcp.tool.interface";
