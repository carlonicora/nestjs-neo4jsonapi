import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * OAuth Discovery Controller
 *
 * Serves the well-known metadata documents MCP clients use to
 * discover the authorization server and protected resource:
 * - RFC 8414 Authorization Server Metadata
 * - RFC 9728 Protected Resource Metadata
 *
 * Both endpoints are public (no guard) per their RFCs and return
 * plain JSON (not JSON:API) — the RFCs mandate their own wire format.
 */
@Controller(".well-known")
export class OAuthDiscoveryController {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Authorization Server Metadata (RFC 8414)
   *
   * GET /.well-known/oauth-authorization-server
   *
   * Endpoint paths mirror the actual routes registered by
   * OAuthTokenController and OAuthRegistrationController.
   *
   * `authorization_endpoint` deliberately points at the WEB app's consent
   * page (app.url), not the API's Bearer-guarded /oauth/authorize route: a
   * browser navigation carries no Authorization header, so the API route can
   * never authenticate it. The web page handles login, then calls the API's
   * authorize/approve endpoint with the user's JWT and redirects back to the
   * client with the authorization code.
   */
  @Get("oauth-authorization-server")
  authorizationServer(): Record<string, unknown> {
    const base = this.baseUrl();
    return {
      issuer: base,
      authorization_endpoint: `${this.appBaseUrl()}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      introspection_endpoint: `${base}/oauth/introspect`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
      scopes_supported: ["mcp"],
    };
  }

  /**
   * Protected Resource Metadata (RFC 9728)
   *
   * GET /.well-known/oauth-protected-resource
   *
   * Consumed by MCP clients to locate the authorization server
   * protecting the /mcp resource.
   */
  @Get("oauth-protected-resource")
  protectedResource(): Record<string, unknown> {
    const base = this.baseUrl();
    return {
      resource: `${base}/mcp`,
      authorization_servers: [base],
    };
  }

  /** API base URL without trailing slash (api.url is normalized to end with one). */
  private baseUrl(): string {
    return this.configService.get<{ url: string }>("api").url.replace(/\/$/, "");
  }

  /** Web-app base URL without trailing slash — hosts the browser-facing consent page. */
  private appBaseUrl(): string {
    return this.configService.get<{ url: string }>("app").url.replace(/\/$/, "");
  }
}
