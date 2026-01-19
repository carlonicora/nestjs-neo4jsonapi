import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { OAuthTokenService } from "./oauth.token.service";
import { OAuthRepository } from "../repositories/oauth.repository";

describe("OAuthTokenService", () => {
  let tokenService: OAuthTokenService;
  let mockRepository: Partial<OAuthRepository>;
  let mockConfigService: Partial<ConfigService>;

  beforeEach(() => {
    mockRepository = {
      createAccessToken: vi.fn().mockResolvedValue("token-id"),
      createRefreshToken: vi.fn().mockResolvedValue("refresh-token-id"),
      findAccessTokenByHash: vi.fn().mockResolvedValue({
        id: "token-id",
        tokenHash: "hash",
        scope: "read write",
        expiresAt: new Date(Date.now() + 3600000),
        isRevoked: false,
        grantType: "authorization_code",
        clientId: "client-id",
        userId: "user-id",
        companyId: "company-id",
      }),
      findRefreshTokenByHash: vi.fn().mockResolvedValue({
        id: "refresh-token-id",
        tokenHash: "hash",
        scope: "read write",
        expiresAt: new Date(Date.now() + 604800000),
        isRevoked: false,
        rotationCounter: 0,
        clientId: "client-id",
        userId: "user-id",
        companyId: "company-id",
      }),
      revokeAccessToken: vi.fn().mockResolvedValue(undefined),
      revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
      revokeAllUserTokensForClient: vi.fn().mockResolvedValue(undefined),
      deleteExpiredTokens: vi.fn().mockResolvedValue(undefined),
      deleteExpiredAuthorizationCodes: vi.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        const config: Record<string, any> = {
          "oauth.accessTokenLifetime": 3600,
          "oauth.refreshTokenLifetime": 604800,
        };
        return config[key];
      }),
    };

    tokenService = new OAuthTokenService(mockRepository as OAuthRepository, mockConfigService as ConfigService);
  });

  describe("generateAccessToken", () => {
    it("should generate a random token", async () => {
      const result = await tokenService.generateAccessToken({
        clientId: "client-id",
        userId: "user-id",
        scope: "read write",
        grantType: "authorization_code",
      });

      expect(result.token).toBeDefined();
      expect(result.token.length).toBeGreaterThan(20);
      expect(result.expiresIn).toBe(3600);
      expect(mockRepository.createAccessToken).toHaveBeenCalled();
    });

    it("should use custom lifetime if provided", async () => {
      const result = await tokenService.generateAccessToken({
        clientId: "client-id",
        scope: "read",
        grantType: "client_credentials",
        lifetimeSeconds: 7200,
      });

      expect(result.expiresIn).toBe(7200);
    });
  });

  describe("generateRefreshToken", () => {
    it("should generate a refresh token", async () => {
      const result = await tokenService.generateRefreshToken({
        clientId: "client-id",
        userId: "user-id",
        scope: "read write",
        accessTokenId: "access-token-id",
      });

      expect(result.token).toBeDefined();
      expect(result.token.length).toBeGreaterThan(30);
      expect(mockRepository.createRefreshToken).toHaveBeenCalled();
    });
  });

  describe("validateAccessToken", () => {
    it("should return validation result for valid token", async () => {
      const result = await tokenService.validateAccessToken("valid-token");

      expect(result).toBeDefined();
      expect(result?.clientId).toBe("client-id");
      expect(result?.userId).toBe("user-id");
    });

    it("should return null for unknown token", async () => {
      mockRepository.findAccessTokenByHash = vi.fn().mockResolvedValue(null);
      const result = await tokenService.validateAccessToken("unknown-token");
      expect(result).toBeNull();
    });

    it("should return null for revoked token", async () => {
      mockRepository.findAccessTokenByHash = vi.fn().mockResolvedValue({
        id: "token-id",
        isRevoked: true,
        expiresAt: new Date(Date.now() + 3600000),
      });
      const result = await tokenService.validateAccessToken("revoked-token");
      expect(result).toBeNull();
    });

    it("should return null for expired token", async () => {
      mockRepository.findAccessTokenByHash = vi.fn().mockResolvedValue({
        id: "token-id",
        isRevoked: false,
        expiresAt: new Date(Date.now() - 1000), // Expired
      });
      const result = await tokenService.validateAccessToken("expired-token");
      expect(result).toBeNull();
    });
  });

  describe("validateRefreshToken", () => {
    it("should return validation result for valid refresh token", async () => {
      const result = await tokenService.validateRefreshToken("valid-refresh-token");

      expect(result).toBeDefined();
      expect(result?.clientId).toBe("client-id");
      expect(result?.userId).toBe("user-id");
    });

    it("should return null for unknown refresh token", async () => {
      mockRepository.findRefreshTokenByHash = vi.fn().mockResolvedValue(null);
      const result = await tokenService.validateRefreshToken("unknown-token");
      expect(result).toBeNull();
    });

    it("should return null for revoked refresh token", async () => {
      mockRepository.findRefreshTokenByHash = vi.fn().mockResolvedValue({
        id: "token-id",
        isRevoked: true,
        expiresAt: new Date(Date.now() + 604800000),
      });
      const result = await tokenService.validateRefreshToken("revoked-token");
      expect(result).toBeNull();
    });
  });

  describe("revokeAccessToken", () => {
    it("should revoke access token by hashing and calling repository", async () => {
      await tokenService.revokeAccessToken("some-raw-token");
      // The service hashes the token before passing to repository
      expect(mockRepository.revokeAccessToken).toHaveBeenCalled();
    });
  });

  describe("revokeRefreshToken", () => {
    it("should revoke refresh token by hashing and calling repository", async () => {
      await tokenService.revokeRefreshToken("some-raw-token");
      // The service hashes the token before passing to repository
      expect(mockRepository.revokeRefreshToken).toHaveBeenCalled();
    });
  });

  describe("revokeAllUserTokens", () => {
    it("should revoke all user tokens for client", async () => {
      await tokenService.revokeAllUserTokens("user-id", "client-id");
      expect(mockRepository.revokeAllUserTokensForClient).toHaveBeenCalledWith("user-id", "client-id");
    });
  });

  describe("introspectToken", () => {
    it("should return active: true for valid access token", async () => {
      const result = await tokenService.introspectToken("valid-token");

      expect(result.active).toBe(true);
      expect(result.scope).toBe("read write");
      expect(result.client_id).toBe("client-id");
    });

    it("should check refresh token if access token not found", async () => {
      mockRepository.findAccessTokenByHash = vi.fn().mockResolvedValue(null);

      const result = await tokenService.introspectToken("refresh-token");

      expect(result.active).toBe(true);
      expect(mockRepository.findRefreshTokenByHash).toHaveBeenCalled();
    });

    it("should return active: false for invalid token", async () => {
      mockRepository.findAccessTokenByHash = vi.fn().mockResolvedValue(null);
      mockRepository.findRefreshTokenByHash = vi.fn().mockResolvedValue(null);

      const result = await tokenService.introspectToken("invalid-token");

      expect(result.active).toBe(false);
      expect(result.scope).toBeUndefined();
    });
  });
});
