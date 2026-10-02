import { OAuthScopeDefinition } from "../../foundations/oauth/constants/oauth.scopes";

/**
 * OAuth2 Server Configuration Interface
 *
 * Controls all OAuth2 Authorization Server settings including token lifetimes,
 * PKCE requirements, and security policies.
 *
 * @see RFC 6749 - OAuth 2.0 Authorization Framework
 * @see RFC 7636 - PKCE Extension
 */
export interface ConfigOAuthInterface {
  /**
   * Master switch to enable/disable the OAuth2 server.
   * When false, all OAuth endpoints return 503 Service Unavailable.
   * @default false
   */
  enabled: boolean;

  /**
   * Authorization code validity period in seconds.
   * Per RFC 6749, codes should be short-lived (recommended max 10 minutes).
   * @default 600 (10 minutes)
   */
  authorizationCodeLifetime: number;

  /**
   * Access token validity period in seconds.
   * Shorter lifetimes are more secure but require more frequent refresh.
   * @default 3600 (1 hour)
   */
  accessTokenLifetime: number;

  /**
   * Refresh token validity period in seconds.
   * Longer than access tokens to allow background refresh without re-authentication.
   * @default 604800 (7 days)
   */
  refreshTokenLifetime: number;

  /**
   * Require PKCE (Proof Key for Code Exchange) for public clients.
   * Public clients cannot securely store secrets, so PKCE provides
   * protection against authorization code interception.
   * @default true
   */
  requirePkceForPublicClients: boolean;

  /**
   * Issue a new refresh token on each token refresh.
   * Enables refresh token rotation which limits the window of exposure
   * if a refresh token is compromised.
   * @default true
   */
  rotateRefreshTokens: boolean;

  /**
   * App-specific scopes registered on top of the built-ins
   * (read, write, profile, mcp, admin).
   * A scope string that duplicates a built-in or another entry is rejected at boot.
   * @default []
   */
  additionalScopes: OAuthScopeDefinition[];
}
