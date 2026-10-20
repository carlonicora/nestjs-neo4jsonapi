// MCP (Model Context Protocol) server — public entry point.

// Module (mounted via BootstrapOptions.mcp === true)
export { McpModule } from "./mcp.module";

// App-contribution surface: register McpToolContribution factories under MCP_TOOLS
// and McpStatusContribution parts of the `ping` reply under MCP_STATUS.
export { MCP_STATUS, MCP_TOOLS } from "./interfaces/mcp.tool.interface";
export type {
  McpStatusContribution,
  McpToolContribution,
  McpToolDefinition,
  McpToolResult,
  McpUserContext,
} from "./interfaces/mcp.tool.interface";
