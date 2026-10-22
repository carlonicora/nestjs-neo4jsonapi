import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { OAuthRepository } from "../repositories/oauth.repository";

export interface GenerateAccessTokenParams {
  clientId: string;
  userId?: string;
  companyId?: string;
  scope: string;
  grantType: string;
  lifetimeSeconds?: number;
}

export interface GenerateRefreshTokenParams {
  clientId: string;
  userId: string;
  companyId?: string;
  scope: string;
  accessTokenId: string;
  lifetimeSeconds?: number;
}

export interface AccessTokenValidationResult {
  tokenId: string;
  clientId: string;
  userId: string | null;
  companyId: string | null;
  scope: string;
  grantType: string;
  expiresAt: Date;
}

export interface RefreshTokenValidationResult {
  tokenId: string;
  clientId: string;
  userId: string;
  companyId: string | null;
  scope: string;
  rotationCounter: number;
  expiresAt: Date;
}

/**
 * OAuth Token Service
 *
 * Handles generation, validation, and revocation of OAuth tokens.
 * Uses opaque tokens with SHA256 hashes stored in the database.
 */
@Injectable()
export class OAuthTokenService {
  /** Access token length in bytes (32 bytes = 256 bits) */
  private static readonly ACCESS_TOKEN_BYTES = 32;

  /** Refresh token length in bytes (48 bytes = 384 bits) */
  private static readonly REFRESH_TOKEN_BYTES = 48;

  constructor(
    private readonly oauthRepository: OAuthRepository,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  /**
   * Generates an opaque access token.
   *
   * The token is a cryptographically random string. Only its SHA256 hash
   * is stored in the database.
   *
   * @returns The token string and expiration info
   */
  async generateAccessToken(
    params: GenerateAccessTokenParams,
  ): Promise<{ token: string; expiresIn: number; tokenId: string }> {
    // Generate cryptographically random token
    const token = crypto.randomBytes(OAuthTokenService.ACCESS_TOKEN_BYTES).toString("base64url");

    // Calculate expiration
    const defaultLifetime = this.configService.get("oauth.accessTokenLifetime", { infer: true }) ?? 3600;
    const expiresIn = params.lifetimeSeconds ?? defaultLifetime;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Store token hash in database
    const tokenId = await this.oauthRepository.createAccessToken({
      token,
      clientId: params.clientId,
      userId: params.userId,
      companyId: params.companyId,
      scope: params.scope,
      grantType: params.grantType,
      expiresAt,
    });

    return { token, expiresIn, tokenId };
  }

  /**
   * Generates an opaque refresh token.
   *
   * Refresh tokens are longer than access tokens and include a rotation
   * counter that is incremented each time the token is used.
   *
   * @returns The token string
   */
  async generateRefreshToken(params: GenerateRefreshTokenParams): Promise<{ token: string; tokenId: string }> {
    // Generate cryptographically random token
    const token = crypto.randomBytes(OAuthTokenService.REFRESH_TOKEN_BYTES).toString("base64url");

    // Calculate expiration
    const defaultLifetime = this.configService.get("oauth.refreshTokenLifetime", { infer: true }) ?? 604800;
    const lifetimeSeconds = params.lifetimeSeconds ?? defaultLifetime;
    const expiresAt = new Date(Date.now() + lifetimeSeconds * 1000);

    // Store token hash in database
    const tokenId = await this.oauthRepository.createRefreshToken({
      token,
      clientId: params.clientId,
      userId: params.userId,
      companyId: params.companyId,
      scope: params.scope,
      accessTokenId: params.accessTokenId,
      expiresAt,
    });

    return { token, tokenId };
  }

  /**
   * Validates an access token.
   *
   * Checks that the token:
   * - Exists (by hash lookup)
   * - Has not expired
   * - Has not been revoked
   *
   * @param token - The raw access token string
   * @returns Validation result or null if invalid
   */
  async validateAccessToken(token: string): Promise<AccessTokenValidationResult | null> {
    // Hash the token for lookup
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find token by hash
    const storedToken = await this.oauthRepository.findAccessTokenByHash(tokenHash);

    if (!storedToken) {
      return null;
    }

    // Check revocation
    if (storedToken.isRevoked) {
      return null;
    }

    // Check expiration
    if (new Date() > storedToken.expiresAt) {
      return null;
    }

    // The user must still be allowed in: a token outlives nothing it was issued
    // for (deleted, deactivated, or removed from the token's company). The token
    // is revoked so a later reinstatement does not revive it.
    if (
      storedToken.userId &&
      !(await this.isSubjectAuthorised({ userId: storedToken.userId, companyId: storedToken.companyId }))
    ) {
      await this.oauthRepository.revokeAccessToken(tokenHash);
      return null;
    }

    return {
      tokenId: storedToken.id,
      clientId: storedToken.clientId,
      userId: storedToken.userId,
      companyId: storedToken.companyId,
      scope: storedToken.scope,
      grantType: storedToken.grantType,
      expiresAt: storedToken.expiresAt,
    };
  }

  /**
   * Validates a refresh token.
   *
   * Checks that the token:
   * - Exists (by hash lookup)
   * - Has not expired
   * - Has not been revoked
   *
   * @param token - The raw refresh token string
   * @returns Validation result or null if invalid
   */
  async validateRefreshToken(token: string): Promise<RefreshTokenValidationResult | null> {
    // Hash the token for lookup
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find token by hash
    const storedToken = await this.oauthRepository.findRefreshTokenByHash(tokenHash);

    if (!storedToken) {
      return null;
    }

    // Check revocation
    if (storedToken.isRevoked) {
      return null;
    }

    // Check expiration
    if (new Date() > storedToken.expiresAt) {
      return null;
    }

    // Same subject check as access tokens: a refresh never extends the access of
    // a user who is deleted, deactivated or removed from the token's company.
    if (!(await this.isSubjectAuthorised({ userId: storedToken.userId, companyId: storedToken.companyId }))) {
      await this.oauthRepository.revokeRefreshToken(tokenHash);
      return null;
    }

    return {
      tokenId: storedToken.id,
      clientId: storedToken.clientId,
      userId: storedToken.userId,
      companyId: storedToken.companyId,
      scope: storedToken.scope,
      rotationCounter: storedToken.rotationCounter,
      expiresAt: storedToken.expiresAt,
    };
  }

  /**
   * Whether the user a token or code was issued to may still use it: the user
   * exists, is not deleted, is active and still belongs to the token's company
   * (when it has one).
   */
  async isSubjectAuthorised(params: { userId: string; companyId: string | null }): Promise<boolean> {
    return this.oauthRepository.isTokenSubjectAuthorised(params);
  }

  /**
   * Revokes an access token.
   *
   * @param token - The raw access token string
   */
  async revokeAccessToken(token: string): Promise<void> {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await this.oauthRepository.revokeAccessToken(tokenHash);
  }

  /**
   * Revokes a refresh token.
   *
   * @param token - The raw refresh token string
   */
  async revokeRefreshToken(token: string): Promise<void> {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await this.oauthRepository.revokeRefreshToken(tokenHash);
  }

  /**
   * Revokes all tokens for a user-client combination.
   *
   * Used when a user revokes access for an application or
   * when implementing logout across all sessions.
   */
  async revokeAllUserTokens(userId: string, clientId: string): Promise<void> {
    await this.oauthRepository.revokeAllUserTokensForClient(userId, clientId);
  }

  /**
   * Gets token metadata for introspection (RFC 7662).
   *
   * @param token - The raw token string
   * @param tokenTypeHint - Optional hint about token type
   * @returns Token metadata or { active: false } if invalid
   */
  async introspectToken(
    token: string,
    tokenTypeHint?: "access_token" | "refresh_token",
  ): Promise<{
    active: boolean;
    scope?: string;
    client_id?: string;
    username?: string;
    token_type?: string;
    exp?: number;
    iat?: number;
    sub?: string;
    aud?: string;
  }> {
    // Try access token first (or based on hint)
    if (tokenTypeHint !== "refresh_token") {
      const accessResult = await this.validateAccessToken(token);
      if (accessResult) {
        return {
          active: true,
          scope: accessResult.scope,
          client_id: accessResult.clientId,
          token_type: "Bearer",
          exp: Math.floor(accessResult.expiresAt.getTime() / 1000),
          sub: accessResult.userId ?? undefined,
          aud: accessResult.clientId,
        };
      }
    }

    // Try refresh token
    if (tokenTypeHint !== "access_token") {
      const refreshResult = await this.validateRefreshToken(token);
      if (refreshResult) {
        return {
          active: true,
          scope: refreshResult.scope,
          client_id: refreshResult.clientId,
          token_type: "refresh_token",
          exp: Math.floor(refreshResult.expiresAt.getTime() / 1000),
          sub: refreshResult.userId,
          aud: refreshResult.clientId,
        };
      }
    }

    // Token not found or invalid
    return { active: false };
  }

  /**
   * Cleans up expired tokens from the database.
   *
   * Should be called periodically (e.g., daily) to remove expired tokens.
   */
  async cleanupExpiredTokens(): Promise<void> {
    await this.oauthRepository.deleteExpiredTokens();
    await this.oauthRepository.deleteExpiredAuthorizationCodes();
  }
}
