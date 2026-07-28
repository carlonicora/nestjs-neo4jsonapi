/**
 * MCP (Model Context Protocol) Server Configuration Interface
 *
 * Controls the MCP server exposed at POST /mcp, which lets external AI agents
 * (claude.ai connectors, Claude Desktop, ChatGPT) interact with the application
 * through OAuth-authenticated, RBAC-gated tools.
 *
 * @see https://modelcontextprotocol.io - Model Context Protocol specification
 */
export interface ConfigMcpInterface {
  /**
   * Master switch to enable/disable the MCP server.
   * When false, the MCP endpoint is not served.
   * @default false
   */
  enabled: boolean;

  /**
   * Server name advertised to MCP clients during initialization.
   * @default "neural-erp"
   */
  serverName: string;

  /**
   * Optional instructions string advertised to MCP clients,
   * describing how to best use this server's tools.
   */
  instructions?: string;

  /**
   * JSON:API types promoted to dedicated per-entity MCP tools,
   * parsed from a comma-separated environment variable.
   * @default []
   */
  promotedEntities: string[];
}
