import { Body, Controller, HttpCode, HttpException, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ConfigOAuthInterface } from "../../../config/interfaces/config.oauth.interface";
import { OAuthRegisterDto } from "../dtos/oauth.register.dto";
import { OAuthClientService } from "../services/oauth.client.service";

/**
 * OAuth Dynamic Client Registration Controller
 *
 * Implements RFC 7591 Dynamic Client Registration.
 * Allows MCP clients (claude.ai connectors, Claude Desktop, ChatGPT)
 * to self-register before starting the authorization code flow.
 *
 * The response is the RFC 7591 client information wire format
 * (plain JSON, not JSON:API) — same convention as /oauth/token.
 */
@Controller("oauth")
export class OAuthRegistrationController {
  constructor(
    private readonly clientService: OAuthClientService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Client Registration Endpoint (RFC 7591 Section 3)
   *
   * POST /oauth/register
   *
   * Public endpoint (no guard) — required by MCP clients, which
   * register before any user credentials exist.
   */
  @Post("register")
  @HttpCode(201)
  async register(@Body() dto: OAuthRegisterDto): Promise<{
    client_id: string;
    client_secret?: string;
    client_id_issued_at: number;
    redirect_uris: string[];
    grant_types: string[];
    token_endpoint_auth_method: string;
    client_name: string;
  }> {
    const oauth = this.configService.get<ConfigOAuthInterface>("oauth");
    if (!oauth?.enabled) {
      throw new HttpException("OAuth is not enabled", 404);
    }

    const isConfidential = dto.token_endpoint_auth_method !== undefined && dto.token_endpoint_auth_method !== "none";

    const { client, clientSecret } = await this.clientService.createClient({
      name: dto.client_name ?? "Dynamically registered client",
      redirectUris: dto.redirect_uris,
      allowedScopes: dto.scope ? dto.scope.split(" ").filter(Boolean) : ["mcp"],
      allowedGrantTypes: dto.grant_types ?? ["authorization_code", "refresh_token"],
      isConfidential,
    });

    return {
      client_id: client.clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: client.redirectUris,
      grant_types: client.allowedGrantTypes,
      token_endpoint_auth_method: isConfidential ? dto.token_endpoint_auth_method! : "none",
      client_name: client.name,
    };
  }
}
