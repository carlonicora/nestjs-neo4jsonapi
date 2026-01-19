import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock the auth discord service to avoid complex dependency chain
vi.mock("../services/auth.discord.service", () => ({
  AuthDiscordService: vi.fn().mockImplementation(() => ({
    generateLoginUrl: vi.fn(),
    exchangeCodeForToken: vi.fn(),
    fetchUserDetails: vi.fn(),
    handleDiscordLogin: vi.fn(),
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
import { AuthDiscordController } from "../controllers/auth.discord.controller";
import { AuthDiscordService } from "../services/auth.discord.service";

describe("AuthDiscordController", () => {
  let controller: AuthDiscordController;
  let authDiscordService: vi.Mocked<AuthDiscordService>;
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

  const mockDiscordConfig = {
    clientId: "discord-client-id",
    clientSecret: "discord-client-secret",
    redirectUrl: "http://localhost:3000/auth/callback/discord",
  };

  beforeEach(async () => {
    const mockAuthDiscordService = {
      generateLoginUrl: vi.fn(),
      exchangeCodeForToken: vi.fn(),
      fetchUserDetails: vi.fn(),
      handleDiscordLogin: vi.fn(),
    };

    const mockConfigService = {
      get: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthDiscordController],
      providers: [
        { provide: AuthDiscordService, useValue: mockAuthDiscordService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<AuthDiscordController>(AuthDiscordController);
    authDiscordService = module.get(AuthDiscordService);
    configService = module.get(ConfigService);
    mockReply = createMockReply();

    // Default config setup
    configService.get.mockReturnValue(mockDiscordConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /auth/discord (loginWithDiscord)", () => {
    it("should redirect to Discord login URL when config is valid", async () => {
      const loginUrl = "https://discord.com/api/oauth2/authorize?client_id=123";
      authDiscordService.generateLoginUrl.mockReturnValue(loginUrl);

      await controller.loginWithDiscord(mockReply);

      expect(authDiscordService.generateLoginUrl).toHaveBeenCalled();
      expect(mockReply.redirect).toHaveBeenCalledWith(loginUrl, 302);
    });

    it("should throw NOT_IMPLEMENTED when clientId is missing", async () => {
      configService.get.mockReturnValue({ ...mockDiscordConfig, clientId: undefined });

      await expect(controller.loginWithDiscord(mockReply)).rejects.toThrow(HttpException);
      await expect(controller.loginWithDiscord(mockReply)).rejects.toMatchObject({
        status: HttpStatus.NOT_IMPLEMENTED,
      });
    });

    it("should throw NOT_IMPLEMENTED when clientSecret is missing", async () => {
      configService.get.mockReturnValue({ ...mockDiscordConfig, clientSecret: undefined });

      await expect(controller.loginWithDiscord(mockReply)).rejects.toThrow("Login with Discord is not available");
    });

    it("should throw NOT_IMPLEMENTED when both client credentials are missing", async () => {
      configService.get.mockReturnValue({ clientId: null, clientSecret: null });

      await expect(controller.loginWithDiscord(mockReply)).rejects.toThrow(HttpException);
    });
  });

  describe("GET /auth/callback/discord (callbackDiscord)", () => {
    const mockCode = "discord-auth-code-123";
    const mockAccessToken = "discord-access-token-456";
    const mockUserDetails = {
      id: "discord-user-id",
      username: "testuser",
      email: "test@example.com",
      discriminator: "1234",
      avatar: "avatar-hash",
    };

    it("should handle Discord callback and redirect to success URL", async () => {
      const redirectUrl = "http://app.example.com/auth?code=success-code";
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authDiscordService.handleDiscordLogin.mockResolvedValue(redirectUrl);

      await controller.callbackDiscord(mockReply, {}, mockCode);

      expect(authDiscordService.exchangeCodeForToken).toHaveBeenCalledWith(mockCode);
      expect(authDiscordService.fetchUserDetails).toHaveBeenCalledWith(mockAccessToken);
      expect(authDiscordService.handleDiscordLogin).toHaveBeenCalledWith({ userDetails: mockUserDetails });
      expect(mockReply.redirect).toHaveBeenCalledWith(redirectUrl, 302);
    });

    it("should pass code to exchange for token", async () => {
      const customCode = "custom-discord-code";
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authDiscordService.handleDiscordLogin.mockResolvedValue("http://redirect.url");

      await controller.callbackDiscord(mockReply, {}, customCode);

      expect(authDiscordService.exchangeCodeForToken).toHaveBeenCalledWith(customCode);
    });

    it("should handle token exchange failure", async () => {
      authDiscordService.exchangeCodeForToken.mockRejectedValue(new Error("Invalid code"));

      await expect(controller.callbackDiscord(mockReply, {}, mockCode)).rejects.toThrow("Invalid code");
    });

    it("should handle user details fetch failure", async () => {
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockRejectedValue(new Error("Failed to fetch user"));

      await expect(controller.callbackDiscord(mockReply, {}, mockCode)).rejects.toThrow("Failed to fetch user");
    });

    it("should handle login processing failure", async () => {
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authDiscordService.handleDiscordLogin.mockRejectedValue(new Error("Login failed"));

      await expect(controller.callbackDiscord(mockReply, {}, mockCode)).rejects.toThrow("Login failed");
    });
  });

  describe("dependency injection", () => {
    it("should have authDiscordService injected", () => {
      expect(controller["authDiscordService"]).toBeDefined();
    });

    it("should have configService injected", () => {
      expect(controller["configService"]).toBeDefined();
    });
  });
});
