import { describe, it, expect, beforeEach, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuthService } from "./oauth.service";
import { OAuthRepository } from "../repositories/oauth.repository";
import { OAuthClientService } from "./oauth.client.service";
import { OAuthTokenService } from "./oauth.token.service";
import { OAuthPkceService } from "./oauth.pkce.service";
import { OAuthClient } from "../entities/oauth.client.entity";

describe("OAuthService", () => {
  let oauthService: OAuthService;
  let mockRepository: Partial<OAuthRepository>;
  let mockClientService: Partial<OAuthClientService>;
  let mockTokenService: Partial<OAuthTokenService>;
  let mockPkceService: Partial<OAuthPkceService>;
  let mockConfigService: Partial<ConfigService>;

  const mockClient: OAuthClient = {
    id: "client-uuid",
    type: "oauth-clients",
    clientId: "test-client-id",
    clientSecretHash: "hashed-secret",
    name: "Test App",
    description: null,
    redirectUris: ["https://example.com/callback"],
    allowedScopes: ["read", "write"],
    allowedGrantTypes: ["authorization_code", "refresh_token"],
    isConfidential: true,
    isActive: true,
    accessTokenLifetime: 3600,
    refreshTokenLifetime: 604800,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockRepository = {
      createAuthorizationCode: vi.fn().mockResolvedValue(undefined),
      findAuthorizationCodeByHash: vi.fn().mockResolvedValue({
        codeHash: "hash",
        clientId: "test-client-id",
        userId: "user-id",
        redirectUri: "https://example.com/callback",
        scope: "read write",
        expiresAt: new Date(Date.now() + 600000),
        isUsed: false,
      }),
      markAuthorizationCodeUsed: vi.fn().mockResolvedValue(true),
      findCompanyIdForUser: vi.fn().mockResolvedValue("company-id"),
    };

    mockClientService = {
      getClient: vi.fn().mockResolvedValue(mockClient),
      validateClient: vi.fn().mockResolvedValue(mockClient),
      validateRedirectUri: vi.fn().mockReturnValue(true),
      validateGrantType: vi.fn().mockReturnValue(true),
      validateScopes: vi.fn().mockReturnValue(true),
    };

    mockTokenService = {
      generateAccessToken: vi.fn().mockResolvedValue({
        token: "access-token",
        expiresIn: 3600,
        tokenId: "token-id",
      }),
      generateRefreshToken: vi.fn().mockResolvedValue({
        token: "refresh-token",
        tokenId: "refresh-token-id",
      }),
      validateRefreshToken: vi.fn().mockResolvedValue({
        tokenId: "refresh-token-id",
        clientId: "test-client-id",
        userId: "user-id",
        companyId: "company-id",
        scope: "read write",
        rotationCounter: 0,
        expiresAt: new Date(Date.now() + 604800000),
      }),
      revokeAccessToken: vi.fn().mockResolvedValue(undefined),
      revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
      revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
      introspectToken: vi.fn().mockResolvedValue({ active: true }),
    };

    mockPkceService = {
      isValidChallengeMethod: vi.fn().mockReturnValue(true),
      validateCodeChallenge: vi.fn().mockReturnValue(true),
    };

    mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        const config: Record<string, any> = {
          "oauth.authorizationCodeLifetime": 600,
          "oauth.accessTokenLifetime": 3600,
          "oauth.refreshTokenLifetime": 604800,
          "oauth.requirePkceForPublicClients": true,
          "oauth.rotateRefreshTokens": true,
          "api.baseUrl": "https://api.example.com",
        };
        return config[key];
      }),
    };

    oauthService = new OAuthService(
      mockRepository as OAuthRepository,
      mockClientService as OAuthClientService,
      mockTokenService as OAuthTokenService,
      mockPkceService as OAuthPkceService,
      mockConfigService as ConfigService,
    );
  });

  describe("initiateAuthorization", () => {
    it("should generate authorization code", async () => {
      const result = await oauthService.initiateAuthorization({
        responseType: "code",
        clientId: "test-client-id",
        redirectUri: "https://example.com/callback",
        scope: "read",
        userId: "user-id",
      });

      expect(result.code).toBeDefined();
      expect(mockRepository.createAuthorizationCode).toHaveBeenCalled();
    });

    it("should reject unsupported response_type", async () => {
      await expect(
        oauthService.initiateAuthorization({
          responseType: "token",
          clientId: "test-client-id",
          redirectUri: "https://example.com/callback",
          userId: "user-id",
        }),
      ).rejects.toThrow(HttpException);
    });

    it("should require PKCE for public clients", async () => {
      mockClientService.getClient = vi.fn().mockResolvedValue({
        ...mockClient,
        isConfidential: false,
      });

      await expect(
        oauthService.initiateAuthorization({
          responseType: "code",
          clientId: "test-client-id",
          redirectUri: "https://example.com/callback",
          userId: "user-id",
          // No code_challenge
        }),
      ).rejects.toThrow(HttpException);
    });

    it("should accept PKCE for public clients", async () => {
      mockClientService.getClient = vi.fn().mockResolvedValue({
        ...mockClient,
        isConfidential: false,
      });

      const result = await oauthService.initiateAuthorization({
        responseType: "code",
        clientId: "test-client-id",
        redirectUri: "https://example.com/callback",
        userId: "user-id",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
      });

      expect(result.code).toBeDefined();
    });
  });

  describe("exchangeAuthorizationCode", () => {
    it("should exchange code for tokens", async () => {
      const result = await oauthService.exchangeAuthorizationCode({
        grantType: "authorization_code",
        code: "auth-code",
        redirectUri: "https://example.com/callback",
        clientId: "test-client-id",
        clientSecret: "secret",
      });

      expect(result.access_token).toBe("access-token");
      expect(result.refresh_token).toBe("refresh-token");
      expect(result.token_type).toBe("Bearer");
    });

    it("should reject invalid client", async () => {
      mockClientService.validateClient = vi.fn().mockResolvedValue(null);

      await expect(
        oauthService.exchangeAuthorizationCode({
          grantType: "authorization_code",
          code: "auth-code",
          redirectUri: "https://example.com/callback",
          clientId: "invalid-client",
        }),
      ).rejects.toThrow(HttpException);
    });

    it("should reject already used code", async () => {
      mockRepository.findAuthorizationCodeByHash = vi.fn().mockResolvedValue({
        isUsed: true,
        userId: "user-id",
        clientId: "test-client-id",
      });

      await expect(
        oauthService.exchangeAuthorizationCode({
          grantType: "authorization_code",
          code: "used-code",
          redirectUri: "https://example.com/callback",
          clientId: "test-client-id",
        }),
      ).rejects.toThrow(HttpException);

      // Should revoke tokens (replay attack prevention)
      expect(mockTokenService.revokeAllUserTokens).toHaveBeenCalled();
    });

    it("should reject expired code", async () => {
      mockRepository.findAuthorizationCodeByHash = vi.fn().mockResolvedValue({
        isUsed: false,
        expiresAt: new Date(Date.now() - 1000), // Expired
        userId: "user-id",
        clientId: "test-client-id",
      });

      await expect(
        oauthService.exchangeAuthorizationCode({
          grantType: "authorization_code",
          code: "expired-code",
          redirectUri: "https://example.com/callback",
          clientId: "test-client-id",
        }),
      ).rejects.toThrow(HttpException);
    });

    it("should validate PKCE code_verifier when code_challenge was provided", async () => {
      mockRepository.findAuthorizationCodeByHash = vi.fn().mockResolvedValue({
        isUsed: false,
        expiresAt: new Date(Date.now() + 600000),
        userId: "user-id",
        clientId: "test-client-id",
        redirectUri: "https://example.com/callback",
        scope: "read",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
      });

      const result = await oauthService.exchangeAuthorizationCode({
        grantType: "authorization_code",
        code: "auth-code",
        redirectUri: "https://example.com/callback",
        clientId: "test-client-id",
        codeVerifier: "verifier",
      });

      expect(mockPkceService.validateCodeChallenge).toHaveBeenCalledWith("verifier", "challenge", "S256");
      expect(result.access_token).toBeDefined();
    });
  });

  describe("clientCredentialsGrant", () => {
    it("should issue token for valid client", async () => {
      mockClientService.validateGrantType = vi.fn().mockReturnValue(true);

      const result = await oauthService.clientCredentialsGrant({
        grantType: "client_credentials",
        clientId: "test-client-id",
        clientSecret: "secret",
        scope: "read",
      });

      expect(result.access_token).toBe("access-token");
      expect(result.refresh_token).toBeUndefined();
    });

    it("should reject unauthorized grant type", async () => {
      mockClientService.validateGrantType = vi.fn().mockReturnValue(false);

      await expect(
        oauthService.clientCredentialsGrant({
          grantType: "client_credentials",
          clientId: "test-client-id",
          clientSecret: "secret",
        }),
      ).rejects.toThrow(HttpException);
    });

    it("should reject invalid client credentials", async () => {
      mockClientService.validateClient = vi.fn().mockResolvedValue(null);

      await expect(
        oauthService.clientCredentialsGrant({
          grantType: "client_credentials",
          clientId: "test-client-id",
          clientSecret: "wrong-secret",
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("refreshTokenGrant", () => {
    it("should issue new tokens", async () => {
      const result = await oauthService.refreshTokenGrant({
        grantType: "refresh_token",
        refreshToken: "refresh-token",
        clientId: "test-client-id",
      });

      expect(result.access_token).toBe("access-token");
      expect(result.refresh_token).toBeDefined(); // Rotation enabled
    });

    it("should reject invalid refresh token", async () => {
      mockTokenService.validateRefreshToken = vi.fn().mockResolvedValue(null);

      await expect(
        oauthService.refreshTokenGrant({
          grantType: "refresh_token",
          refreshToken: "invalid-token",
          clientId: "test-client-id",
        }),
      ).rejects.toThrow(HttpException);
    });

    it("should reject scope expansion", async () => {
      mockTokenService.validateRefreshToken = vi.fn().mockResolvedValue({
        tokenId: "token-id",
        clientId: "test-client-id",
        userId: "user-id",
        scope: "read",
        rotationCounter: 0,
        expiresAt: new Date(Date.now() + 604800000),
      });

      await expect(
        oauthService.refreshTokenGrant({
          grantType: "refresh_token",
          refreshToken: "refresh-token",
          clientId: "test-client-id",
          scope: "read write admin", // Trying to expand
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("revokeToken", () => {
    it("should not throw on invalid token (RFC 7009)", async () => {
      mockTokenService.revokeAccessToken = vi.fn().mockResolvedValue(undefined);
      mockTokenService.revokeRefreshToken = vi.fn().mockResolvedValue(undefined);

      // Should not throw - RFC 7009 requires success even for invalid tokens
      await expect(
        oauthService.revokeToken({
          token: "invalid-token",
          clientId: "test-client-id",
        }),
      ).resolves.toBeUndefined();
    });

    it("should revoke access token when hint provided", async () => {
      await oauthService.revokeToken({
        token: "access-token",
        tokenTypeHint: "access_token",
        clientId: "test-client-id",
      });

      expect(mockTokenService.revokeAccessToken).toHaveBeenCalled();
    });

    it("should revoke refresh token when hint provided", async () => {
      await oauthService.revokeToken({
        token: "refresh-token",
        tokenTypeHint: "refresh_token",
        clientId: "test-client-id",
      });

      expect(mockTokenService.revokeRefreshToken).toHaveBeenCalled();
    });
  });

  describe("introspectToken", () => {
    it("should delegate to token service", async () => {
      mockTokenService.introspectToken = vi.fn().mockResolvedValue({
        active: true,
        scope: "read",
        client_id: "test-client-id",
      });

      const result = await oauthService.introspectToken({
        token: "valid-token",
        clientId: "test-client-id",
        clientSecret: "secret",
      });

      expect(result.active).toBe(true);
      expect(mockTokenService.introspectToken).toHaveBeenCalled();
    });
  });
});
