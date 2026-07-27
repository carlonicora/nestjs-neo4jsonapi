import {
  Controller,
  Delete,
  Get,
  HttpException,
  NotFoundException,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { FastifyReply, FastifyRequest } from "fastify";
import { ClsService } from "nestjs-cls";
import { UserModulesRepository } from "../../agents/graph/repositories/user-modules.repository";
import { ConfigMcpInterface } from "../../config/interfaces/config.mcp.interface";
import { OAuthTokenGuard } from "../../foundations/oauth/guards/oauth.token.guard";
import { McpAuthFilter } from "../filters/mcp.auth.filter";
import { McpUserContext } from "../interfaces/mcp.tool.interface";
import { McpServerFactory } from "../services/mcp.server.factory";

/**
 * MCP (Model Context Protocol) endpoint — stateless Streamable HTTP.
 *
 * Each `POST /mcp` request is authenticated by the existing OAuthTokenGuard
 * (which populates CLS `userId`/`companyId`), then handed to a fresh per-request
 * MCP Server + StreamableHTTPServerTransport pair (`sessionIdGenerator:
 * undefined` — stateless mode, no session tracking). GET/DELETE are rejected
 * with 405: stateless servers expose no SSE notification channel and no
 * session to terminate.
 *
 * Uses `@Res()` with raw reply writing (the SDK transport writes directly to
 * `res.raw`), which opts this handler out of Nest response serialization —
 * the MCP wire format is JSON-RPC, not JSON:API, matching how the OAuth
 * controllers speak their own RFC-mandated wire formats.
 */
@Controller("mcp")
@UseFilters(McpAuthFilter)
@UseGuards(OAuthTokenGuard)
export class McpController {
  constructor(
    private readonly factory: McpServerFactory,
    private readonly cls: ClsService,
    private readonly userModules: UserModulesRepository,
    private readonly configService: ConfigService,
  ) {}

  /** Handles one stateless MCP Streamable-HTTP request (initialize, tools/list, tools/call, ...). */
  @Post()
  async handle(@Req() req: FastifyRequest, @Res() res: FastifyReply): Promise<void> {
    if (!this.configService.get<ConfigMcpInterface>("mcp")?.enabled) {
      throw new NotFoundException();
    }

    const userId = this.cls.get("userId");
    const companyId = this.cls.get("companyId");
    const ctx: McpUserContext = {
      userId,
      companyId,
      userModuleIds: await this.userModules.findModuleIdsForUser(userId),
    };

    const server = this.factory.create(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); // stateless
    res.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    // Fastify has already parsed the JSON body — pass it through so the SDK
    // does not attempt to re-read the (already consumed) request stream.
    await transport.handleRequest(req.raw, res.raw, req.body);
  }

  /** Stateless server: no SSE notification stream is offered. */
  @Get()
  rejectGet(): never {
    throw new HttpException("Method Not Allowed", 405);
  }

  /** Stateless server: there is no session to terminate. */
  @Delete()
  rejectDelete(): never {
    throw new HttpException("Method Not Allowed", 405);
  }
}
