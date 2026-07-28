import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.modules";
import { SearchDocumentsTool } from "../agents/operator/tools/search-documents.tool";
import { OAuthModule } from "../foundations/oauth/oauth.module";
import { RbacPermissionModule } from "../foundations/rbac/rbac-permission.module";
import { McpController } from "./controllers/mcp.controller";
import { McpEntityWriteService } from "./services/mcp.entity.write.service";
import { McpGenericToolsService } from "./services/mcp.generic.tools.service";
import { McpPromotedToolsFactory } from "./services/mcp.promoted.tools.factory";
import { McpServerFactory } from "./services/mcp.server.factory";
import { McpToolRegistry } from "./services/mcp.tool.registry";

/**
 * MCP (Model Context Protocol) server module.
 *
 * Mounted by the bootstrap gate (`BootstrapOptions.mcp === true`) and served
 * at `POST /mcp`, OAuth-authenticated and RBAC-gated. Exports McpToolRegistry
 * so consuming apps can contribute additional tools via the MCP_TOOLS token.
 *
 * Module wiring notes:
 * - `RbacPermissionModule` supplies RbacPermissionService (the RbacModule
 *   proper is a config-requiring dynamic module and cannot be imported here).
 * - Audit is NOT wired here: AbstractService.create/put audits internally when
 *   the concrete entity service injects AuditService, so MCP writes audit
 *   exactly like HTTP writes.
 * - `SearchDocumentsTool` is provided locally: OperatorModule declares but
 *   does not export it, and importing OperatorModule would drag in its
 *   forwardRef(AssistantModule) cycle. Its dependencies (ToolFactory,
 *   ContextualiserService) are exported by AgentsModule's inner modules.
 * - EntityServiceRegistry, Neo4jService, ClsService and ConfigService resolve
 *   through the global core/cls/config modules.
 */
@Module({
  imports: [OAuthModule, RbacPermissionModule, AgentsModule],
  controllers: [McpController],
  providers: [
    McpServerFactory,
    McpToolRegistry,
    McpGenericToolsService,
    McpEntityWriteService,
    McpPromotedToolsFactory,
    SearchDocumentsTool,
  ],
  exports: [McpToolRegistry],
})
export class McpModule {}
