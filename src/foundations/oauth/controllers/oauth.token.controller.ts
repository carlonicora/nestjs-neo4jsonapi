import { Controller, Post, Body, HttpCode, Header, UseFilters } from "@nestjs/common";
import { OAuthErrorFilter } from "../filters/oauth.error.filter";
import { OAuthService } from "../services/oauth.service";
import { OAuthTokenRequestDto, OAuthTokenResponseDto } from "../dtos/oauth.token.dto";
import { OAuthRevokeRequestDto } from "../dtos/oauth.revoke.dto";
import { OAuthIntrospectRequestDto, OAuthIntrospectResponseDto } from "../dtos/oauth.introspect.dto";

/**
 * OAuth Token Controller
 *
 * Handles token-related endpoints per RFC 6749, RFC 7009, RFC 7662.
 * All endpoints accept application/x-www-form-urlencoded.
 */
@Controller("oauth")
@UseFilters(OAuthErrorFilter)
export class OAuthTokenController {
  constructor(private readonly oauthService: OAuthService) {}

  /**
   * Token Endpoint (RFC 6749 Section 3.2)
   *
   * POST /oauth/token
   *
   * Handles all grant types:
   * - authorization_code
   * - client_credentials
   * - refresh_token
   */
  @Post("token")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  async token(@Body() body: OAuthTokenRequestDto): Promise<OAuthTokenResponseDto> {
    switch (body.grant_type) {
      case "authorization_code":
        return this.oauthService.exchangeAuthorizationCode({
          grantType: "authorization_code",
          code: body.code!,
          redirectUri: body.redirect_uri!,
          clientId: body.client_id,
          clientSecret: body.client_secret,
          codeVerifier: body.code_verifier,
        });

      case "client_credentials":
        return this.oauthService.clientCredentialsGrant({
          grantType: "client_credentials",
          clientId: body.client_id,
          clientSecret: body.client_secret!,
          scope: body.scope,
        });

      case "refresh_token":
        return this.oauthService.refreshTokenGrant({
          grantType: "refresh_token",
          refreshToken: body.refresh_token!,
          clientId: body.client_id,
          clientSecret: body.client_secret,
          scope: body.scope,
        });

      default:
        throw new Error("Unsupported grant type");
    }
  }

  /**
   * Token Revocation Endpoint (RFC 7009)
   *
   * POST /oauth/revoke
   *
   * Revokes an access or refresh token.
   * Always returns 200 OK per RFC 7009.
   */
  @Post("revoke")
  @HttpCode(200)
  async revoke(@Body() body: OAuthRevokeRequestDto): Promise<void> {
    await this.oauthService.revokeToken({
      token: body.token,
      tokenTypeHint: body.token_type_hint,
      clientId: body.client_id,
      clientSecret: body.client_secret,
    });
  }

  /**
   * Token Introspection Endpoint (RFC 7662)
   *
   * POST /oauth/introspect
   *
   * Returns token metadata for valid tokens.
   * Returns { active: false } for invalid/expired tokens.
   */
  @Post("introspect")
  @HttpCode(200)
  async introspect(@Body() body: OAuthIntrospectRequestDto): Promise<OAuthIntrospectResponseDto> {
    return this.oauthService.introspectToken({
      token: body.token,
      tokenTypeHint: body.token_type_hint,
      clientId: body.client_id,
      clientSecret: body.client_secret,
    });
  }
}
