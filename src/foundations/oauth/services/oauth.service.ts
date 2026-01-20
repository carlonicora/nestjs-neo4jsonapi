import { HttpException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { OAuthErrorCodes, createOAuthError } from "../constants/oauth.errors";
import {
  OAuthScopeDescriptions,
  OAuthScopeNames,
  OAuthScopeType,
  parseScopes,
  validateScopes as validateScopesUtil,
} from "../constants/oauth.scopes";
import { OAuthRepository } from "../repositories/oauth.repository";
import { OAuthClientService } from "./oauth.client.service";
import { OAuthPkceService } from "./oauth.pkce.service";
import { OAuthTokenService } from "./oauth.token.service";

export interface AuthorizeParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  userId: string;
}

export interface TokenCodeParams {
  grantType: "authorization_code";
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier?: string;
}

export interface ClientCredentialsParams {
  grantType: "client_credentials";
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export interface RefreshTokenParams {
  grantType: "refresh_token";
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface RevokeParams {
  token: string;
  tokenTypeHint?: "access_token" | "refresh_token";
  clientId: string;
  clientSecret?: string;
}

export interface IntrospectParams {
  token: string;
  tokenTypeHint?: "access_token" | "refresh_token";
  clientId: string;
  clientSecret: string;
}

export interface ConsentInfoParams {
  clientId: string;
  redirectUri: string;
  scope?: string;
}

export interface ConsentInfoResponse {
  client: {
    id: string;
    type: "oauth-clients";
    attributes: {
      name: string;
      description?: string;
    };
  };
  scopes: Array<{
    scope: string;
    name: string;
    description: string;
  }>;
}

export interface ConsentApproveParams {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  userId: string;
}

export interface ConsentDenyParams {
  redirectUri: string;
  state?: string;
}

/**
 * Main OAuth Service
 *
 * Orchestrates OAuth2 flows including authorization code, client credentials,
 * and refresh token grants. Implements RFC 6749, RFC 7009, and RFC 7662.
 */
@Injectable()
export class OAuthService {
  constructor(
    private readonly oauthRepository: OAuthRepository,
    private readonly clientService: OAuthClientService,
    private readonly tokenService: OAuthTokenService,
    private readonly pkceService: OAuthPkceService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  /**
   * Initiates the authorization code flow.
   *
   * Validates the request, generates an authorization code, and returns
   * the code to be included in the redirect response.
   *
   * @returns Authorization code and state
   */
  async initiateAuthorization(params: AuthorizeParams): Promise<{ code: string; state?: string }> {
    // Validate response_type
    if (params.responseType !== "code") {
      throw new HttpException(
        createOAuthError(OAuthErrorCodes.UNSUPPORTED_RESPONSE_TYPE, "Only response_type=code is supported"),
        400,
      );
    }

    // Validate client
    const client = await this.clientService.getClient(params.clientId);
    if (!client || !client.isActive) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_CLIENT, "Unknown client"), 401);
    }

    // Validate redirect URI
    if (!this.clientService.validateRedirectUri(client, params.redirectUri)) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_REQUEST, "Invalid redirect_uri"), 400);
    }

    // Validate grant type
    if (!this.clientService.validateGrantType(client, "authorization_code")) {
      throw new HttpException(
        createOAuthError(OAuthErrorCodes.UNAUTHORIZED_CLIENT, "Client not authorized for authorization_code grant"),
        400,
      );
    }

    // Parse and validate scopes
    const requestedScopes = params.scope ? parseScopes(params.scope) : client.allowedScopes;
    if (!validateScopesUtil(requestedScopes)) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_SCOPE), 400);
    }
    if (!this.clientService.validateScopes(client, requestedScopes)) {
      throw new HttpException(
        createOAuthError(OAuthErrorCodes.INVALID_SCOPE, "Requested scopes exceed allowed scopes"),
        400,
      );
    }

    // Validate PKCE for public clients
    const requirePkce =
      !client.isConfidential && (this.configService.get("oauth.requirePkceForPublicClients", { infer: true }) ?? true);

    if (requirePkce && !params.codeChallenge) {
      throw new HttpException(
        createOAuthError(OAuthErrorCodes.INVALID_REQUEST, "code_challenge required for public clients"),
        400,
      );
    }

    // Validate code_challenge_method
    let codeChallengeMethod: "S256" | "plain" | undefined;
    if (params.codeChallenge) {
      codeChallengeMethod = (params.codeChallengeMethod as "S256" | "plain") || "S256";
      if (!this.pkceService.isValidChallengeMethod(codeChallengeMethod)) {
        throw new HttpException(
          createOAuthError(OAuthErrorCodes.INVALID_REQUEST, "Invalid code_challenge_method"),
          400,
        );
      }
    }

    // Generate authorization code
    const code = crypto.randomBytes(32).toString("base64url");
    const codeLifetime = this.configService.get("oauth.authorizationCodeLifetime", { infer: true }) ?? 600;
    const expiresAt = new Date(Date.now() + codeLifetime * 1000);
    // Store authorization code
    await this.oauthRepository.createAuthorizationCode({
      code,
      clientId: params.clientId,
      userId: params.userId,
      redirectUri: params.redirectUri,
      scope: requestedScopes.join(" "),
      state: params.state,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod,
      expiresAt,
    });

    return { code, state: params.state };
  }

  /**
   * Exchanges an authorization code for tokens.
   *
   * Validates the code, PKCE verifier (if applicable), and issues
   * access and refresh tokens.
   */
  async exchangeAuthorizationCode(params: TokenCodeParams): Promise<TokenResponse> {
    // Validate client
    const client = await this.clientService.validateClient(params.clientId, params.clientSecret);
    if (!client) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_CLIENT), 401);
    }

    // Hash the code for lookup
    const codeHash = crypto.createHash("sha256").update(params.code).digest("hex");

    // Find and validate authorization code
    const storedCode = await this.oauthRepository.findAuthorizationCodeByHash(codeHash);
    if (!storedCode) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_GRANT, "Invalid authorization code"), 400);
    }

    // Check if code is already used (replay attack prevention)
    if (storedCode.isUsed) {
      // Potential replay attack - revoke all tokens from this code
      await this.tokenService.revokeAllUserTokens(storedCode.userId, params.clientId);
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_GRANT, "Authorization code already used"), 400);
    }

    // Check expiration
    if (new Date() > storedCode.expiresAt) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_GRANT, "Authorization code expired"), 400);
    }

    // Check client ID matches
    if (storedCode.clientId !== params.clientId) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_GRANT, "Client mismatch"), 400);
    }

    // Check redirect URI matches
    if (storedCode.redirectUri !== params.redirectUri) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_GRANT, "Redirect URI mismatch"), 400);
    }

    // Validate PKCE
    if (storedCode.codeChallenge) {
      if (!params.codeVerifier) {
        throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_REQUEST, "code_verifier required"), 400);
      }
      const isValid = this.pkceService.validateCodeChallenge(
        params.codeVerifier,
        storedCode.codeChallenge,
        storedCode.codeChallengeMethod!,
      );
      if (!isValid) {
        throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_GRANT, "Invalid code_verifier"), 400);
      }
    }

    // Mark code as used (atomically)
    const marked = await this.oauthRepository.markAuthorizationCodeUsed(codeHash);
    if (!marked) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_GRANT, "Authorization code already used"), 400);
    }

    // Look up user's company for proper scoping
    const companyId = await this.oauthRepository.findCompanyIdForUser(storedCode.userId);

    // Generate tokens
    const {
      token: accessToken,
      expiresIn,
      tokenId: accessTokenId,
    } = await this.tokenService.generateAccessToken({
      clientId: params.clientId,
      userId: storedCode.userId,
      companyId: companyId ?? undefined,
      scope: storedCode.scope,
      grantType: "authorization_code",
      lifetimeSeconds: client.accessTokenLifetime,
    });

    const { token: refreshToken } = await this.tokenService.generateRefreshToken({
      clientId: params.clientId,
      userId: storedCode.userId,
      companyId: companyId ?? undefined,
      scope: storedCode.scope,
      accessTokenId,
      lifetimeSeconds: client.refreshTokenLifetime,
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: storedCode.scope,
    };
  }

  /**
   * Processes a client credentials grant.
   *
   * Issues an access token directly to the client (no user involvement).
   * Only available to confidential clients.
   */
  async clientCredentialsGrant(params: ClientCredentialsParams): Promise<TokenResponse> {
    // Validate client credentials
    const client = await this.clientService.validateClient(params.clientId, params.clientSecret);
    if (!client) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_CLIENT), 401);
    }

    // Check grant type is allowed
    if (!this.clientService.validateGrantType(client, "client_credentials")) {
      throw new HttpException(
        createOAuthError(OAuthErrorCodes.UNAUTHORIZED_CLIENT, "Client not authorized for client_credentials grant"),
        400,
      );
    }

    // Parse and validate scopes
    const requestedScopes = params.scope ? parseScopes(params.scope) : client.allowedScopes;
    if (!this.clientService.validateScopes(client, requestedScopes)) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_SCOPE), 400);
    }

    // Generate access token (no refresh token for client_credentials)
    const { token: accessToken, expiresIn } = await this.tokenService.generateAccessToken({
      clientId: params.clientId,
      scope: requestedScopes.join(" "),
      grantType: "client_credentials",
      lifetimeSeconds: client.accessTokenLifetime,
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: requestedScopes.join(" "),
    };
  }

  /**
   * Processes a refresh token grant.
   *
   * Validates the refresh token and issues new access/refresh tokens.
   * Supports token rotation if configured.
   */
  async refreshTokenGrant(params: RefreshTokenParams): Promise<TokenResponse> {
    // Validate client
    const client = await this.clientService.validateClient(params.clientId, params.clientSecret);
    if (!client) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_CLIENT), 401);
    }

    // Validate refresh token
    const refreshTokenData = await this.tokenService.validateRefreshToken(params.refreshToken);
    if (!refreshTokenData) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_GRANT, "Invalid refresh token"), 400);
    }

    // Check client ID matches
    if (refreshTokenData.clientId !== params.clientId) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_GRANT, "Client mismatch"), 400);
    }

    // Determine scope (can narrow but not expand)
    let scope = refreshTokenData.scope;
    if (params.scope) {
      const requestedScopes = parseScopes(params.scope);
      const originalScopes = parseScopes(refreshTokenData.scope);
      // Check all requested scopes are in original scope
      if (!requestedScopes.every((s) => originalScopes.includes(s))) {
        throw new HttpException(
          createOAuthError(OAuthErrorCodes.INVALID_SCOPE, "Cannot expand scope beyond original grant"),
          400,
        );
      }
      scope = params.scope;
    }

    // Revoke old refresh token
    await this.tokenService.revokeRefreshToken(params.refreshToken);

    // Generate new tokens
    const {
      token: accessToken,
      expiresIn,
      tokenId: accessTokenId,
    } = await this.tokenService.generateAccessToken({
      clientId: params.clientId,
      userId: refreshTokenData.userId,
      companyId: refreshTokenData.companyId ?? undefined,
      scope,
      grantType: "refresh_token",
      lifetimeSeconds: client.accessTokenLifetime,
    });

    // Generate new refresh token if rotation is enabled
    let newRefreshToken: string | undefined;
    if (this.configService.get("oauth.rotateRefreshTokens", { infer: true }) ?? true) {
      const { token } = await this.tokenService.generateRefreshToken({
        clientId: params.clientId,
        userId: refreshTokenData.userId,
        companyId: refreshTokenData.companyId ?? undefined,
        scope,
        accessTokenId,
        lifetimeSeconds: client.refreshTokenLifetime,
      });
      newRefreshToken = token;
    }

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
      scope,
    };
  }

  /**
   * Revokes a token (RFC 7009).
   *
   * Always returns success, even if the token was invalid or already revoked.
   * This prevents token fishing attacks.
   */
  async revokeToken(params: RevokeParams): Promise<void> {
    // Validate client (optional but recommended)
    if (params.clientSecret) {
      const client = await this.clientService.validateClient(params.clientId, params.clientSecret);
      if (!client) {
        // Per RFC 7009, still return success for invalid clients
        return;
      }
    }

    // Try to revoke as access token first (or based on hint)
    if (params.tokenTypeHint !== "refresh_token") {
      try {
        await this.tokenService.revokeAccessToken(params.token);
      } catch {
        // Ignore errors - token may not exist or may be wrong type
      }
    }

    // Try to revoke as refresh token
    if (params.tokenTypeHint !== "access_token") {
      try {
        await this.tokenService.revokeRefreshToken(params.token);
      } catch {
        // Ignore errors
      }
    }

    // Always return success per RFC 7009
  }

  /**
   * Introspects a token (RFC 7662).
   *
   * Returns token metadata for valid tokens, or { active: false } for
   * invalid, expired, or revoked tokens.
   */
  async introspectToken(params: IntrospectParams): Promise<{
    active: boolean;
    scope?: string;
    client_id?: string;
    username?: string;
    token_type?: string;
    exp?: number;
    iat?: number;
    sub?: string;
    aud?: string;
    iss?: string;
  }> {
    // Validate client credentials (required for introspection)
    const client = await this.clientService.validateClient(params.clientId, params.clientSecret);
    if (!client) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_CLIENT), 401);
    }

    // Delegate to token service
    const result = await this.tokenService.introspectToken(params.token, params.tokenTypeHint);

    // Add issuer if active
    if (result.active) {
      const apiUrl = this.configService.get("api.url", { infer: true }) ?? "https://api.only35.app";
      return {
        ...result,
        iss: apiUrl,
      };
    }

    return result;
  }

  // ============================================
  // CONSENT FLOW METHODS
  // ============================================

  /**
   * Gets client information for the consent screen.
   *
   * Validates the client and redirect URI, then returns the client info
   * and scope descriptions for display on the consent screen.
   */
  async getConsentInfo(params: ConsentInfoParams): Promise<ConsentInfoResponse> {
    // Validate client
    const client = await this.clientService.getClient(params.clientId);
    if (!client || !client.isActive) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_CLIENT, "Unknown client"), 401);
    }

    // Validate redirect URI
    if (!this.clientService.validateRedirectUri(client, params.redirectUri)) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_REQUEST, "Invalid redirect_uri"), 400);
    }

    // Validate grant type
    if (!this.clientService.validateGrantType(client, "authorization_code")) {
      throw new HttpException(
        createOAuthError(OAuthErrorCodes.UNAUTHORIZED_CLIENT, "Client not authorized for authorization_code grant"),
        400,
      );
    }

    // Parse and validate scopes
    const requestedScopes = params.scope ? parseScopes(params.scope) : client.allowedScopes;
    if (!validateScopesUtil(requestedScopes)) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_SCOPE), 400);
    }
    if (!this.clientService.validateScopes(client, requestedScopes)) {
      throw new HttpException(
        createOAuthError(OAuthErrorCodes.INVALID_SCOPE, "Requested scopes exceed allowed scopes"),
        400,
      );
    }

    // Build scope info for consent screen
    const scopeInfo = requestedScopes.map((scope) => ({
      scope,
      name: OAuthScopeNames[scope as OAuthScopeType] || scope,
      description: OAuthScopeDescriptions[scope as OAuthScopeType] || `Access to ${scope}`,
    }));

    return {
      client: {
        id: client.clientId,
        type: "oauth-clients",
        attributes: {
          name: client.name,
          description: client.description,
        },
      },
      scopes: scopeInfo,
    };
  }

  /**
   * Approves the authorization request and issues an authorization code.
   *
   * Called after the user has consented to the authorization.
   * Returns a redirect URL with the authorization code.
   */
  async approveAuthorization(params: ConsentApproveParams): Promise<{ redirectUrl: string }> {
    // Use existing initiateAuthorization logic
    const { code, state } = await this.initiateAuthorization({
      responseType: "code",
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scope: params.scope,
      state: params.state,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      userId: params.userId,
    });

    // Build redirect URL with code
    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }

    return { redirectUrl: redirectUrl.toString() };
  }

  /**
   * Denies the authorization request.
   *
   * Returns a redirect URL with an access_denied error.
   */
  async denyAuthorization(params: ConsentDenyParams): Promise<{ redirectUrl: string }> {
    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("error", OAuthErrorCodes.ACCESS_DENIED);
    redirectUrl.searchParams.set("error_description", "The user denied the authorization request");
    if (params.state) {
      redirectUrl.searchParams.set("state", params.state);
    }

    return { redirectUrl: redirectUrl.toString() };
  }
}
