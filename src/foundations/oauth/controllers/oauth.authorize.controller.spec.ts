import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock guards before imports
vi.mock("../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock OAuth service to avoid complex dependency chain
vi.mock("../services/oauth.service", () => ({
  OAuthService: vi.fn().mockImplementation(() => ({
    initiateAuthorization: vi.fn(),
  })),
}));

// Mock nestjs-cls
vi.mock("nestjs-cls", () => ({
  ClsService: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
  })),
}));

import { HttpException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { FastifyReply } from "fastify";
import { ClsService } from "nestjs-cls";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { OAuthErrorCodes } from "../constants/oauth.errors";
import { OAuthAuthorizeQueryDto } from "../dtos/oauth.authorize.dto";
import { OAuthService } from "../services/oauth.service";
import { OAuthAuthorizeController } from "./oauth.authorize.controller";

describe("OAuthAuthorizeController", () => {
  let controller: OAuthAuthorizeController;
  let oauthService: vi.Mocked<OAuthService>;
  let clsService: vi.Mocked<ClsService>;
  let mockReply: vi.Mocked<FastifyReply>;

  // Test data constants
  const MOCK_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const MOCK_CLIENT_ID = "660e8400-e29b-41d4-a716-446655440001";
  const MOCK_AUTH_CODE = "auth_code_123";
  const MOCK_REDIRECT_URI = "https://example.com/callback";
  const MOCK_STATE = "random_state_123";

  const mockAuthorizeQuery: OAuthAuthorizeQueryDto = {
    response_type: "code",
    client_id: MOCK_CLIENT_ID,
    redirect_uri: MOCK_REDIRECT_URI,
    scope: "read write",
    state: MOCK_STATE,
    code_challenge: "challenge123",
    code_challenge_method: "S256",
  };

  beforeEach(async () => {
    const mockOAuthService = {
      initiateAuthorization: vi.fn(),
    };

    const mockClsService = {
      get: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthAuthorizeController],
      providers: [
        { provide: OAuthService, useValue: mockOAuthService },
        { provide: ClsService, useValue: mockClsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OAuthAuthorizeController>(OAuthAuthorizeController);
    oauthService = module.get(OAuthService);
    clsService = module.get(ClsService);

    // Mock FastifyReply
    mockReply = {
      redirect: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("authorize", () => {
    describe("successful authorization", () => {
      it("should redirect with authorization code and state", async () => {
        clsService.get.mockReturnValue(MOCK_USER_ID);
        oauthService.initiateAuthorization.mockResolvedValue({
          code: MOCK_AUTH_CODE,
          state: MOCK_STATE,
        });

        await controller.authorize(mockAuthorizeQuery, mockReply);

        expect(clsService.get).toHaveBeenCalledWith("userId");
        expect(oauthService.initiateAuthorization).toHaveBeenCalledWith({
          responseType: "code",
          clientId: MOCK_CLIENT_ID,
          redirectUri: MOCK_REDIRECT_URI,
          scope: "read write",
          state: MOCK_STATE,
          codeChallenge: "challenge123",
          codeChallengeMethod: "S256",
          userId: MOCK_USER_ID,
        });
        expect(mockReply.redirect).toHaveBeenCalledWith(
          expect.stringContaining(`${MOCK_REDIRECT_URI}?code=${MOCK_AUTH_CODE}&state=${MOCK_STATE}`),
          302,
        );
      });

      it("should redirect with authorization code without state when state is not returned", async () => {
        clsService.get.mockReturnValue(MOCK_USER_ID);
        oauthService.initiateAuthorization.mockResolvedValue({
          code: MOCK_AUTH_CODE,
          state: undefined,
        });

        const queryWithoutState = { ...mockAuthorizeQuery, state: undefined };
        await controller.authorize(queryWithoutState, mockReply);

        expect(mockReply.redirect).toHaveBeenCalledWith(expect.stringContaining(`code=${MOCK_AUTH_CODE}`), 302);
        // State should not be in the URL
        const redirectUrl = (mockReply.redirect as any).mock.calls[0][0];
        expect(redirectUrl).not.toContain("state=");
      });

      it("should handle authorization without optional parameters", async () => {
        clsService.get.mockReturnValue(MOCK_USER_ID);
        oauthService.initiateAuthorization.mockResolvedValue({
          code: MOCK_AUTH_CODE,
          state: undefined,
        });

        const minimalQuery: OAuthAuthorizeQueryDto = {
          response_type: "code",
          client_id: MOCK_CLIENT_ID,
          redirect_uri: MOCK_REDIRECT_URI,
        };

        await controller.authorize(minimalQuery, mockReply);

        expect(oauthService.initiateAuthorization).toHaveBeenCalledWith({
          responseType: "code",
          clientId: MOCK_CLIENT_ID,
          redirectUri: MOCK_REDIRECT_URI,
          scope: undefined,
          state: undefined,
          codeChallenge: undefined,
          codeChallengeMethod: undefined,
          userId: MOCK_USER_ID,
        });
      });
    });

    describe("authentication errors", () => {
      it("should throw 401 when userId is not present in CLS", async () => {
        clsService.get.mockReturnValue(undefined);

        await expect(controller.authorize(mockAuthorizeQuery, mockReply)).rejects.toThrow(
          new HttpException("Authentication required", 401),
        );

        expect(oauthService.initiateAuthorization).not.toHaveBeenCalled();
        expect(mockReply.redirect).not.toHaveBeenCalled();
      });

      it("should throw 401 when userId is null", async () => {
        clsService.get.mockReturnValue(null);

        await expect(controller.authorize(mockAuthorizeQuery, mockReply)).rejects.toThrow(
          new HttpException("Authentication required", 401),
        );
      });
    });

    describe("error handling with redirect", () => {
      it("should redirect with error when OAuthService throws HttpException with error details", async () => {
        clsService.get.mockReturnValue(MOCK_USER_ID);
        const oauthError = new HttpException(
          {
            error: OAuthErrorCodes.INVALID_CLIENT,
            error_description: "Client not found",
          },
          400,
        );
        oauthService.initiateAuthorization.mockRejectedValue(oauthError);

        await controller.authorize(mockAuthorizeQuery, mockReply);

        expect(mockReply.redirect).toHaveBeenCalledWith(
          expect.stringContaining(`error=${OAuthErrorCodes.INVALID_CLIENT}`),
          302,
        );
        expect(mockReply.redirect).toHaveBeenCalledWith(
          expect.stringContaining("error_description=Client+not+found"),
          302,
        );
        expect(mockReply.redirect).toHaveBeenCalledWith(expect.stringContaining(`state=${MOCK_STATE}`), 302);
      });

      it("should redirect with server_error when OAuthService throws HttpException without error field", async () => {
        clsService.get.mockReturnValue(MOCK_USER_ID);
        const genericError = new HttpException("Something went wrong", 500);
        oauthService.initiateAuthorization.mockRejectedValue(genericError);

        await controller.authorize(mockAuthorizeQuery, mockReply);

        expect(mockReply.redirect).toHaveBeenCalledWith(
          expect.stringContaining(`error=${OAuthErrorCodes.SERVER_ERROR}`),
          302,
        );
      });

      it("should redirect with server_error when OAuthService throws non-HttpException error", async () => {
        clsService.get.mockReturnValue(MOCK_USER_ID);
        const unexpectedError = new Error("Unexpected database error");
        oauthService.initiateAuthorization.mockRejectedValue(unexpectedError);

        await controller.authorize(mockAuthorizeQuery, mockReply);

        expect(mockReply.redirect).toHaveBeenCalledWith(
          expect.stringContaining(`error=${OAuthErrorCodes.SERVER_ERROR}`),
          302,
        );
        expect(mockReply.redirect).toHaveBeenCalledWith(
          expect.stringContaining("error_description=An+unexpected+error+occurred"),
          302,
        );
      });

      it("should include state in error redirect when state was provided", async () => {
        clsService.get.mockReturnValue(MOCK_USER_ID);
        oauthService.initiateAuthorization.mockRejectedValue(new Error("Error"));

        await controller.authorize(mockAuthorizeQuery, mockReply);

        expect(mockReply.redirect).toHaveBeenCalledWith(expect.stringContaining(`state=${MOCK_STATE}`), 302);
      });

      it("should not include state in error redirect when state was not provided", async () => {
        clsService.get.mockReturnValue(MOCK_USER_ID);
        oauthService.initiateAuthorization.mockRejectedValue(new Error("Error"));

        const queryWithoutState = { ...mockAuthorizeQuery, state: undefined };
        await controller.authorize(queryWithoutState, mockReply);

        const redirectUrl = (mockReply.redirect as any).mock.calls[0][0];
        expect(redirectUrl).not.toContain("state=");
      });
    });

    describe("edge cases", () => {
      it("should handle redirect_uri with existing query parameters", async () => {
        clsService.get.mockReturnValue(MOCK_USER_ID);
        oauthService.initiateAuthorization.mockResolvedValue({
          code: MOCK_AUTH_CODE,
          state: MOCK_STATE,
        });

        const queryWithComplexRedirect = {
          ...mockAuthorizeQuery,
          redirect_uri: "https://example.com/callback?existing=param",
        };

        await controller.authorize(queryWithComplexRedirect, mockReply);

        expect(mockReply.redirect).toHaveBeenCalledWith(expect.stringContaining(`code=${MOCK_AUTH_CODE}`), 302);
      });

      it("should properly encode special characters in redirect URL", async () => {
        clsService.get.mockReturnValue(MOCK_USER_ID);
        oauthService.initiateAuthorization.mockResolvedValue({
          code: "code with spaces",
          state: "state&special=chars",
        });

        await controller.authorize(mockAuthorizeQuery, mockReply);

        // URL should be properly encoded
        expect(mockReply.redirect).toHaveBeenCalledWith(expect.any(String), 302);
      });
    });
  });

  describe("dependency injection", () => {
    it("should have oauthService injected", () => {
      expect(controller["oauthService"]).toBeDefined();
    });

    it("should have clsService injected", () => {
      expect(controller["cls"]).toBeDefined();
    });
  });
});
