import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock the auth google service to avoid complex dependency chain
vi.mock("../services/auth.google.service", () => ({
  AuthGoogleService: vi.fn().mockImplementation(() => ({
    generateLoginUrl: vi.fn(),
    parseInviteCodeFromState: vi.fn(),
    exchangeCodeForToken: vi.fn(),
    fetchUserDetails: vi.fn(),
    handleGoogleLogin: vi.fn(),
  })),
}));

// Mock authMeta used in controller decorator
vi.mock("..", () => ({
  authMeta: {
    type: "auths",
    endpoint: "auth",
    nodeName: "auth",
    labelName: "Auth",
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpException, HttpStatus } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { AuthGoogleController } from "../controllers/auth.google.controller";
import { AuthGoogleService } from "../services/auth.google.service";

describe("AuthGoogleController", () => {
  let controller: AuthGoogleController;
  let authGoogleService: vi.Mocked<AuthGoogleService>;
  let configService: vi.Mocked<ConfigService>;
  let mockReply: vi.Mocked<FastifyReply>;

  const createMockReply = (): vi.Mocked<FastifyReply> => {
    return {
      redirect: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
    } as unknown as vi.Mocked<FastifyReply>;
  };

  const mockGoogleConfig = {
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
    redirectUrl: "http://localhost:3000/auth/callback/google",
  };

  beforeEach(async () => {
    const mockAuthGoogleService = {
      generateLoginUrl: vi.fn(),
      parseInviteCodeFromState: vi.fn(),
      exchangeCodeForToken: vi.fn(),
      fetchUserDetails: vi.fn(),
      handleGoogleLogin: vi.fn(),
    };

    const mockConfigService = {
      get: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthGoogleController],
      providers: [
        { provide: AuthGoogleService, useValue: mockAuthGoogleService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<AuthGoogleController>(AuthGoogleController);
    authGoogleService = module.get(AuthGoogleService);
    configService = module.get(ConfigService);
    mockReply = createMockReply();

    // Default config setup
    configService.get.mockReturnValue(mockGoogleConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /auth/google (loginWithGoogle)", () => {
    it("should redirect to Google login URL when config is valid", async () => {
      const loginUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=123";
      authGoogleService.generateLoginUrl.mockReturnValue(loginUrl);

      await controller.loginWithGoogle(mockReply);

      expect(authGoogleService.generateLoginUrl).toHaveBeenCalled();
      expect(mockReply.redirect).toHaveBeenCalledWith(loginUrl, 302);
    });

    it("should throw NOT_IMPLEMENTED when clientId is missing", async () => {
      configService.get.mockReturnValue({ ...mockGoogleConfig, clientId: undefined });

      await expect(controller.loginWithGoogle(mockReply)).rejects.toThrow(HttpException);
      await expect(controller.loginWithGoogle(mockReply)).rejects.toMatchObject({
        status: HttpStatus.NOT_IMPLEMENTED,
      });
    });

    it("should throw NOT_IMPLEMENTED when clientSecret is missing", async () => {
      configService.get.mockReturnValue({ ...mockGoogleConfig, clientSecret: undefined });

      await expect(controller.loginWithGoogle(mockReply)).rejects.toThrow("Login with Google is not available");
    });

    it("should throw NOT_IMPLEMENTED when both client credentials are missing", async () => {
      configService.get.mockReturnValue({ clientId: null, clientSecret: null });

      await expect(controller.loginWithGoogle(mockReply)).rejects.toThrow(HttpException);
    });
  });

  describe("GET /auth/callback/google (callbackGoogle)", () => {
    const mockCode = "google-auth-code-123";
    const mockAccessToken = "google-access-token-456";
    const mockUserDetails = {
      id: "google-user-id",
      email: "test@gmail.com",
      name: "Test User",
      given_name: "Test",
      family_name: "User",
      picture: "https://google.com/avatar.jpg",
    };

    it("should handle Google callback and redirect to success URL", async () => {
      const redirectUrl = "http://app.example.com/auth?code=success-code";
      authGoogleService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authGoogleService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authGoogleService.handleGoogleLogin.mockResolvedValue(redirectUrl);

      await controller.callbackGoogle(mockReply, mockCode);

      expect(authGoogleService.exchangeCodeForToken).toHaveBeenCalledWith(mockCode);
      expect(authGoogleService.fetchUserDetails).toHaveBeenCalledWith(mockAccessToken);
      expect(authGoogleService.handleGoogleLogin).toHaveBeenCalledWith({ userDetails: mockUserDetails });
      expect(mockReply.redirect).toHaveBeenCalledWith(redirectUrl, 302);
    });

    it("should pass code to exchange for token", async () => {
      const customCode = "custom-google-code";
      authGoogleService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authGoogleService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authGoogleService.handleGoogleLogin.mockResolvedValue("http://redirect.url");

      await controller.callbackGoogle(mockReply, customCode);

      expect(authGoogleService.exchangeCodeForToken).toHaveBeenCalledWith(customCode);
    });

    it("should handle token exchange failure", async () => {
      authGoogleService.exchangeCodeForToken.mockRejectedValue(new Error("Invalid code"));

      await expect(controller.callbackGoogle(mockReply, mockCode)).rejects.toThrow("Invalid code");
    });

    it("should handle user details fetch failure", async () => {
      authGoogleService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authGoogleService.fetchUserDetails.mockRejectedValue(new Error("Failed to fetch user"));

      await expect(controller.callbackGoogle(mockReply, mockCode)).rejects.toThrow("Failed to fetch user");
    });

    it("should handle login processing failure", async () => {
      authGoogleService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authGoogleService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authGoogleService.handleGoogleLogin.mockRejectedValue(new Error("Login failed"));

      await expect(controller.callbackGoogle(mockReply, mockCode)).rejects.toThrow("Login failed");
    });
  });

  describe("dependency injection", () => {
    it("should have authGoogleService injected", () => {
      expect(controller["authGoogleService"]).toBeDefined();
    });

    it("should have configService injected", () => {
      expect(controller["configService"]).toBeDefined();
    });
  });
});
