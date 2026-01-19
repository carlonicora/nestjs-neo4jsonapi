import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock OAuth service
vi.mock("../services/oauth.service", () => ({
  OAuthService: vi.fn().mockImplementation(() => ({
    exchangeAuthorizationCode: vi.fn(),
    clientCredentialsGrant: vi.fn(),
    refreshTokenGrant: vi.fn(),
    revokeToken: vi.fn(),
    introspectToken: vi.fn(),
  })),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { OAuthIntrospectRequestDto } from "../dtos/oauth.introspect.dto";
import { OAuthRevokeRequestDto } from "../dtos/oauth.revoke.dto";
import { OAuthTokenRequestDto } from "../dtos/oauth.token.dto";
import { OAuthService } from "../services/oauth.service";
import { OAuthTokenController } from "./oauth.token.controller";

describe("OAuthTokenController", () => {
  let controller: OAuthTokenController;
  let oauthService: vi.Mocked<OAuthService>;

  // Test data constants
  const MOCK_CLIENT_ID = "550e8400-e29b-41d4-a716-446655440000";
  const MOCK_CLIENT_SECRET = "secret_abc123";
  const MOCK_AUTH_CODE = "auth_code_xyz";
  const MOCK_REDIRECT_URI = "https://example.com/callback";
  const MOCK_ACCESS_TOKEN = "access_token_123";
  const MOCK_REFRESH_TOKEN = "refresh_token_456";
  const MOCK_CODE_VERIFIER = "code_verifier_789";

  const mockTokenResponse = {
    access_token: MOCK_ACCESS_TOKEN,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: MOCK_REFRESH_TOKEN,
    scope: "read write",
  };

  beforeEach(async () => {
    const mockOAuthService = {
      exchangeAuthorizationCode: vi.fn(),
      clientCredentialsGrant: vi.fn(),
      refreshTokenGrant: vi.fn(),
      revokeToken: vi.fn(),
      introspectToken: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthTokenController],
      providers: [{ provide: OAuthService, useValue: mockOAuthService }],
    }).compile();

    controller = module.get<OAuthTokenController>(OAuthTokenController);
    oauthService = module.get(OAuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("token", () => {
    describe("authorization_code grant", () => {
      it("should exchange authorization code for tokens", async () => {
        const body: OAuthTokenRequestDto = {
          grant_type: "authorization_code",
          code: MOCK_AUTH_CODE,
          redirect_uri: MOCK_REDIRECT_URI,
          client_id: MOCK_CLIENT_ID,
          client_secret: MOCK_CLIENT_SECRET,
        };
        oauthService.exchangeAuthorizationCode.mockResolvedValue(mockTokenResponse);

        const result = await controller.token(body);

        expect(oauthService.exchangeAuthorizationCode).toHaveBeenCalledWith({
          grantType: "authorization_code",
          code: MOCK_AUTH_CODE,
          redirectUri: MOCK_REDIRECT_URI,
          clientId: MOCK_CLIENT_ID,
          clientSecret: MOCK_CLIENT_SECRET,
          codeVerifier: undefined,
        });
        expect(result).toEqual(mockTokenResponse);
      });

      it("should exchange authorization code with PKCE code verifier", async () => {
        const body: OAuthTokenRequestDto = {
          grant_type: "authorization_code",
          code: MOCK_AUTH_CODE,
          redirect_uri: MOCK_REDIRECT_URI,
          client_id: MOCK_CLIENT_ID,
          code_verifier: MOCK_CODE_VERIFIER,
        };
        oauthService.exchangeAuthorizationCode.mockResolvedValue(mockTokenResponse);

        await controller.token(body);

        expect(oauthService.exchangeAuthorizationCode).toHaveBeenCalledWith({
          grantType: "authorization_code",
          code: MOCK_AUTH_CODE,
          redirectUri: MOCK_REDIRECT_URI,
          clientId: MOCK_CLIENT_ID,
          clientSecret: undefined,
          codeVerifier: MOCK_CODE_VERIFIER,
        });
      });

      it("should handle service errors", async () => {
        const body: OAuthTokenRequestDto = {
          grant_type: "authorization_code",
          code: MOCK_AUTH_CODE,
          redirect_uri: MOCK_REDIRECT_URI,
          client_id: MOCK_CLIENT_ID,
        };
        oauthService.exchangeAuthorizationCode.mockRejectedValue(new Error("Invalid code"));

        await expect(controller.token(body)).rejects.toThrow("Invalid code");
      });
    });

    describe("client_credentials grant", () => {
      it("should issue tokens for client credentials", async () => {
        const body: OAuthTokenRequestDto = {
          grant_type: "client_credentials",
          client_id: MOCK_CLIENT_ID,
          client_secret: MOCK_CLIENT_SECRET,
          scope: "read write",
        };
        oauthService.clientCredentialsGrant.mockResolvedValue(mockTokenResponse);

        const result = await controller.token(body);

        expect(oauthService.clientCredentialsGrant).toHaveBeenCalledWith({
          grantType: "client_credentials",
          clientId: MOCK_CLIENT_ID,
          clientSecret: MOCK_CLIENT_SECRET,
          scope: "read write",
        });
        expect(result).toEqual(mockTokenResponse);
      });

      it("should handle client credentials without scope", async () => {
        const body: OAuthTokenRequestDto = {
          grant_type: "client_credentials",
          client_id: MOCK_CLIENT_ID,
          client_secret: MOCK_CLIENT_SECRET,
        };
        oauthService.clientCredentialsGrant.mockResolvedValue(mockTokenResponse);

        await controller.token(body);

        expect(oauthService.clientCredentialsGrant).toHaveBeenCalledWith({
          grantType: "client_credentials",
          clientId: MOCK_CLIENT_ID,
          clientSecret: MOCK_CLIENT_SECRET,
          scope: undefined,
        });
      });

      it("should handle service errors", async () => {
        const body: OAuthTokenRequestDto = {
          grant_type: "client_credentials",
          client_id: MOCK_CLIENT_ID,
          client_secret: MOCK_CLIENT_SECRET,
        };
        oauthService.clientCredentialsGrant.mockRejectedValue(new Error("Invalid client"));

        await expect(controller.token(body)).rejects.toThrow("Invalid client");
      });
    });

    describe("refresh_token grant", () => {
      it("should refresh tokens", async () => {
        const body: OAuthTokenRequestDto = {
          grant_type: "refresh_token",
          refresh_token: MOCK_REFRESH_TOKEN,
          client_id: MOCK_CLIENT_ID,
          client_secret: MOCK_CLIENT_SECRET,
        };
        oauthService.refreshTokenGrant.mockResolvedValue(mockTokenResponse);

        const result = await controller.token(body);

        expect(oauthService.refreshTokenGrant).toHaveBeenCalledWith({
          grantType: "refresh_token",
          refreshToken: MOCK_REFRESH_TOKEN,
          clientId: MOCK_CLIENT_ID,
          clientSecret: MOCK_CLIENT_SECRET,
          scope: undefined,
        });
        expect(result).toEqual(mockTokenResponse);
      });

      it("should refresh tokens with scope restriction", async () => {
        const body: OAuthTokenRequestDto = {
          grant_type: "refresh_token",
          refresh_token: MOCK_REFRESH_TOKEN,
          client_id: MOCK_CLIENT_ID,
          scope: "read",
        };
        oauthService.refreshTokenGrant.mockResolvedValue(mockTokenResponse);

        await controller.token(body);

        expect(oauthService.refreshTokenGrant).toHaveBeenCalledWith({
          grantType: "refresh_token",
          refreshToken: MOCK_REFRESH_TOKEN,
          clientId: MOCK_CLIENT_ID,
          clientSecret: undefined,
          scope: "read",
        });
      });

      it("should handle service errors", async () => {
        const body: OAuthTokenRequestDto = {
          grant_type: "refresh_token",
          refresh_token: MOCK_REFRESH_TOKEN,
          client_id: MOCK_CLIENT_ID,
        };
        oauthService.refreshTokenGrant.mockRejectedValue(new Error("Invalid refresh token"));

        await expect(controller.token(body)).rejects.toThrow("Invalid refresh token");
      });
    });

    describe("unsupported grant type", () => {
      it("should throw error for unsupported grant type", async () => {
        const body: OAuthTokenRequestDto = {
          grant_type: "password" as any,
          client_id: MOCK_CLIENT_ID,
        };

        await expect(controller.token(body)).rejects.toThrow("Unsupported grant type");
      });
    });
  });

  describe("revoke", () => {
    it("should revoke access token", async () => {
      const body: OAuthRevokeRequestDto = {
        token: MOCK_ACCESS_TOKEN,
        token_type_hint: "access_token",
        client_id: MOCK_CLIENT_ID,
        client_secret: MOCK_CLIENT_SECRET,
      };
      oauthService.revokeToken.mockResolvedValue(undefined);

      await controller.revoke(body);

      expect(oauthService.revokeToken).toHaveBeenCalledWith({
        token: MOCK_ACCESS_TOKEN,
        tokenTypeHint: "access_token",
        clientId: MOCK_CLIENT_ID,
        clientSecret: MOCK_CLIENT_SECRET,
      });
    });

    it("should revoke refresh token", async () => {
      const body: OAuthRevokeRequestDto = {
        token: MOCK_REFRESH_TOKEN,
        token_type_hint: "refresh_token",
        client_id: MOCK_CLIENT_ID,
        client_secret: MOCK_CLIENT_SECRET,
      };
      oauthService.revokeToken.mockResolvedValue(undefined);

      await controller.revoke(body);

      expect(oauthService.revokeToken).toHaveBeenCalledWith({
        token: MOCK_REFRESH_TOKEN,
        tokenTypeHint: "refresh_token",
        clientId: MOCK_CLIENT_ID,
        clientSecret: MOCK_CLIENT_SECRET,
      });
    });

    it("should revoke token without type hint", async () => {
      const body: OAuthRevokeRequestDto = {
        token: MOCK_ACCESS_TOKEN,
        client_id: MOCK_CLIENT_ID,
      };
      oauthService.revokeToken.mockResolvedValue(undefined);

      await controller.revoke(body);

      expect(oauthService.revokeToken).toHaveBeenCalledWith({
        token: MOCK_ACCESS_TOKEN,
        tokenTypeHint: undefined,
        clientId: MOCK_CLIENT_ID,
        clientSecret: undefined,
      });
    });

    it("should handle service errors silently (per RFC 7009)", async () => {
      const body: OAuthRevokeRequestDto = {
        token: MOCK_ACCESS_TOKEN,
        client_id: MOCK_CLIENT_ID,
      };
      oauthService.revokeToken.mockRejectedValue(new Error("Token not found"));

      await expect(controller.revoke(body)).rejects.toThrow("Token not found");
    });
  });

  describe("introspect", () => {
    const mockIntrospectResponse = {
      active: true,
      client_id: MOCK_CLIENT_ID,
      token_type: "Bearer",
      scope: "read write",
      exp: 1234567890,
      iat: 1234564290,
      sub: "user123",
    };

    it("should introspect active access token", async () => {
      const body: OAuthIntrospectRequestDto = {
        token: MOCK_ACCESS_TOKEN,
        token_type_hint: "access_token",
        client_id: MOCK_CLIENT_ID,
        client_secret: MOCK_CLIENT_SECRET,
      };
      oauthService.introspectToken.mockResolvedValue(mockIntrospectResponse);

      const result = await controller.introspect(body);

      expect(oauthService.introspectToken).toHaveBeenCalledWith({
        token: MOCK_ACCESS_TOKEN,
        tokenTypeHint: "access_token",
        clientId: MOCK_CLIENT_ID,
        clientSecret: MOCK_CLIENT_SECRET,
      });
      expect(result).toEqual(mockIntrospectResponse);
    });

    it("should return inactive for expired token", async () => {
      const body: OAuthIntrospectRequestDto = {
        token: "expired_token",
        client_id: MOCK_CLIENT_ID,
        client_secret: MOCK_CLIENT_SECRET,
      };
      oauthService.introspectToken.mockResolvedValue({ active: false });

      const result = await controller.introspect(body);

      expect(result).toEqual({ active: false });
    });

    it("should introspect without type hint", async () => {
      const body: OAuthIntrospectRequestDto = {
        token: MOCK_ACCESS_TOKEN,
        client_id: MOCK_CLIENT_ID,
        client_secret: MOCK_CLIENT_SECRET,
      };
      oauthService.introspectToken.mockResolvedValue(mockIntrospectResponse);

      await controller.introspect(body);

      expect(oauthService.introspectToken).toHaveBeenCalledWith({
        token: MOCK_ACCESS_TOKEN,
        tokenTypeHint: undefined,
        clientId: MOCK_CLIENT_ID,
        clientSecret: MOCK_CLIENT_SECRET,
      });
    });

    it("should handle service errors", async () => {
      const body: OAuthIntrospectRequestDto = {
        token: MOCK_ACCESS_TOKEN,
        client_id: MOCK_CLIENT_ID,
        client_secret: MOCK_CLIENT_SECRET,
      };
      oauthService.introspectToken.mockRejectedValue(new Error("Invalid client"));

      await expect(controller.introspect(body)).rejects.toThrow("Invalid client");
    });
  });

  describe("dependency injection", () => {
    it("should have oauthService injected", () => {
      expect(controller["oauthService"]).toBeDefined();
    });
  });
});
