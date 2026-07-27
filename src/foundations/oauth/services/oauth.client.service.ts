import { HttpException, Injectable } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { OAuthErrorCodes, createOAuthError } from "../constants/oauth.errors";
import { VALID_OAUTH_SCOPES } from "../constants/oauth.scopes";
import { OAuthClient } from "../entities/oauth.client.entity";
import { OAuthRepository } from "../repositories/oauth.repository";

export interface CreateClientParams {
  name: string;
  description?: string;
  redirectUris: string[];
  allowedScopes: string[];
  allowedGrantTypes?: string[];
  isConfidential?: boolean;
  accessTokenLifetime?: number;
  refreshTokenLifetime?: number;
  /** Owning user. Optional: dynamically registered clients (RFC 7591) have no owner. */
  ownerId?: string;
  companyId?: string;
}

export interface UpdateClientParams {
  name?: string;
  description?: string;
  redirectUris?: string[];
  allowedScopes?: string[];
  isActive?: boolean;
}

/**
 * OAuth Client Service
 *
 * Manages OAuth client registration, validation, and lifecycle.
 * Handles client credentials securely using bcrypt hashing.
 */
@Injectable()
export class OAuthClientService {
  private static readonly DEFAULT_GRANT_TYPES = ["authorization_code", "refresh_token"];

  constructor(private readonly oauthRepository: OAuthRepository) {}

  /**
   * Creates a new OAuth client.
   *
   * For confidential clients, generates and returns the client secret.
   * The secret is only returned once at creation time.
   *
   * @returns The created client and the client secret (for confidential clients)
   */
  async createClient(params: CreateClientParams): Promise<{ client: OAuthClient; clientSecret?: string }> {
    // Validate redirect URIs
    for (const uri of params.redirectUris) {
      if (!this.isValidRedirectUri(uri)) {
        throw new HttpException(
          createOAuthError(
            OAuthErrorCodes.INVALID_REQUEST,
            `Invalid redirect URI: ${uri}. HTTP URLs are only allowed for localhost, 127.0.0.1, [::1], or domains ending in .test, .localhost, or .local`,
          ),
          400,
        );
      }
    }

    // Validate scopes
    for (const scope of params.allowedScopes) {
      if (!VALID_OAUTH_SCOPES.includes(scope)) {
        throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_SCOPE, `Invalid scope: ${scope}`), 400);
      }
    }

    const isConfidential = params.isConfidential ?? true;
    const allowedGrantTypes = params.allowedGrantTypes ?? OAuthClientService.DEFAULT_GRANT_TYPES;

    // Validate grant types
    if (!isConfidential && allowedGrantTypes.includes("client_credentials")) {
      throw new HttpException(
        createOAuthError(OAuthErrorCodes.INVALID_REQUEST, "Public clients cannot use client_credentials grant"),
        400,
      );
    }

    return this.oauthRepository.createClient({
      name: params.name,
      description: params.description,
      redirectUris: params.redirectUris,
      allowedScopes: params.allowedScopes,
      allowedGrantTypes,
      isConfidential,
      accessTokenLifetime: params.accessTokenLifetime,
      refreshTokenLifetime: params.refreshTokenLifetime,
      ownerId: params.ownerId,
      companyId: params.companyId,
    });
  }

  /**
   * Retrieves a client by its public client ID.
   */
  async getClient(clientId: string): Promise<OAuthClient | null> {
    return this.oauthRepository.findClientByClientId(clientId);
  }

  /**
   * Retrieves all clients owned by a user.
   */
  async getClientsByOwner(ownerId: string): Promise<OAuthClient[]> {
    return this.oauthRepository.findClientsByOwnerId(ownerId);
  }

  /**
   * Validates client credentials.
   *
   * For confidential clients, validates the client secret using bcrypt.
   * For public clients, only validates that the client exists.
   *
   * @param clientId - The client's public identifier
   * @param clientSecret - The client secret (required for confidential clients)
   * @returns The validated client or null if invalid
   */
  async validateClient(clientId: string, clientSecret?: string): Promise<OAuthClient | null> {
    const client = await this.oauthRepository.findClientByClientId(clientId);

    if (!client) {
      return null;
    }

    if (!client.isActive) {
      return null;
    }

    // For confidential clients, validate the secret
    if (client.isConfidential) {
      if (!clientSecret || !client.clientSecretHash) {
        return null;
      }

      const isValid = await bcrypt.compare(clientSecret, client.clientSecretHash);
      if (!isValid) {
        return null;
      }
    }

    return client;
  }

  /**
   * Validates a redirect URI against the client's registered URIs.
   *
   * Per RFC 6749, redirect URIs must match exactly - no wildcards or
   * pattern matching is allowed.
   *
   * @param client - The OAuth client
   * @param redirectUri - The redirect URI to validate
   * @returns true if the redirect URI is valid for this client
   */
  validateRedirectUri(client: OAuthClient, redirectUri: string): boolean {
    // Exact match required per RFC 6749 Section 3.1.2.3
    return client.redirectUris.includes(redirectUri);
  }

  /**
   * Validates that requested scopes are allowed for the client.
   *
   * @param client - The OAuth client
   * @param requestedScopes - Array of requested scope strings
   * @returns true if all requested scopes are allowed
   */
  validateScopes(client: OAuthClient, requestedScopes: string[]): boolean {
    // Empty scope request is valid (will use default scopes)
    if (requestedScopes.length === 0) {
      return true;
    }

    // All requested scopes must be in client's allowed scopes
    return requestedScopes.every((scope) => client.allowedScopes.includes(scope));
  }

  /**
   * Validates that a grant type is allowed for the client.
   *
   * @param client - The OAuth client
   * @param grantType - The grant type to validate
   * @returns true if the grant type is allowed
   */
  validateGrantType(client: OAuthClient, grantType: string): boolean {
    return client.allowedGrantTypes.includes(grantType);
  }

  /**
   * Updates an OAuth client.
   *
   * Note: client_id and client_secret cannot be modified.
   */
  async updateClient(clientId: string, params: UpdateClientParams): Promise<OAuthClient> {
    // Validate new redirect URIs if provided
    if (params.redirectUris) {
      for (const uri of params.redirectUris) {
        if (!this.isValidRedirectUri(uri)) {
          throw new HttpException(
            createOAuthError(
              OAuthErrorCodes.INVALID_REQUEST,
              `Invalid redirect URI: ${uri}. HTTP URLs are only allowed for localhost, 127.0.0.1, [::1], or domains ending in .test, .localhost, or .local`,
            ),
            400,
          );
        }
      }
    }

    // Validate new scopes if provided
    if (params.allowedScopes) {
      for (const scope of params.allowedScopes) {
        if (!VALID_OAUTH_SCOPES.includes(scope)) {
          throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_SCOPE, `Invalid scope: ${scope}`), 400);
        }
      }
    }

    return this.oauthRepository.updateClient(clientId, params);
  }

  /**
   * Regenerates the client secret for a confidential client.
   *
   * The new secret is returned only once. The old secret is immediately
   * invalidated.
   *
   * @returns The new client secret
   */
  async regenerateSecret(clientId: string): Promise<{ clientSecret: string }> {
    const client = await this.oauthRepository.findClientByClientId(clientId);

    if (!client) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_CLIENT, "Client not found"), 404);
    }

    if (!client.isConfidential) {
      throw new HttpException(
        createOAuthError(OAuthErrorCodes.INVALID_REQUEST, "Public clients do not have secrets"),
        400,
      );
    }

    return this.oauthRepository.regenerateClientSecret(clientId);
  }

  /**
   * Deletes an OAuth client and all associated tokens.
   */
  async deleteClient(clientId: string): Promise<void> {
    const client = await this.oauthRepository.findClientByClientId(clientId);

    if (!client) {
      throw new HttpException(createOAuthError(OAuthErrorCodes.INVALID_CLIENT, "Client not found"), 404);
    }

    await this.oauthRepository.deleteClient(clientId);
  }

  /**
   * Validates a redirect URI format.
   *
   * Allowed formats:
   * - https:// URLs (required for production)
   * - http://localhost, http://127.0.0.1, http://[::1] (development only)
   * - http://*.test, http://*.localhost, http://*.local (RFC 6761 reserved TLDs for development)
   * - Custom schemes (myapp://callback)
   *
   * Not allowed:
   * - Fragment identifiers (#)
   * - Wildcards
   */
  private isValidRedirectUri(uri: string): boolean {
    try {
      // Check for fragment (not allowed)
      if (uri.includes("#")) {
        return false;
      }

      // Parse the URI
      const url = new URL(uri);

      // Allow custom schemes (for native apps)
      if (!["http:", "https:"].includes(url.protocol)) {
        // Custom scheme - must have a host (the callback identifier)
        return url.host.length > 0 || url.pathname.length > 0;
      }

      // For http, only allow local development URLs
      if (url.protocol === "http:") {
        const hostname = url.hostname.toLowerCase();

        // Standard localhost variants
        if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
          return true;
        }

        // RFC 6761 reserved TLDs for local development
        // .test - Reserved for testing
        // .localhost - Reserved for localhost
        // .local - Common for mDNS/Bonjour local development
        if (hostname.endsWith(".test") || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
          return true;
        }

        return false;
      }

      // https is always allowed
      return true;
    } catch {
      return false;
    }
  }
}
