import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";

// Mock the auth discord service to avoid complex dependency chain
vi.mock("../services/auth.discord.service", () => ({
  AuthDiscordService: vi.fn().mockImplementation(() => ({
    generateLoginUrl: vi.fn(),
    parseStateData: vi.fn(),
    exchangeCodeForToken: vi.fn(),
    fetchUserDetails: vi.fn(),
    handleDiscordLogin: vi.fn(),
  })),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpException, HttpStatus } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { AuthDiscordController } from "../controllers/auth.discord.controller";
import { AuthDiscordService } from "../services/auth.discord.service";

describe("AuthDiscordController", () => {
  let controller: AuthDiscordController;
  let authDiscordService: Mocked<AuthDiscordService>;
  let configService: Mocked<ConfigService>;
  let mockReply: Mocked<FastifyReply>;

  const createMockReply = (): Mocked<FastifyReply> => {
    return {
      redirect: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
    } as unknown as Mocked<FastifyReply>;
  };

  const mockDiscordConfig = {
    clientId: "discord-client-id",
    clientSecret: "discord-client-secret",
    redirectUrl: "http://localhost:3000/auth/callback/discord",
  };

  beforeEach(async () => {
    const mockAuthDiscordService = {
      generateLoginUrl: vi.fn(),
      parseStateData: vi.fn(),
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
      authDiscordService.parseStateData.mockReturnValue(undefined);
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authDiscordService.handleDiscordLogin.mockResolvedValue(redirectUrl);

      await controller.callbackDiscord(mockReply, mockCode);

      expect(authDiscordService.exchangeCodeForToken).toHaveBeenCalledWith(mockCode);
      expect(authDiscordService.fetchUserDetails).toHaveBeenCalledWith(mockAccessToken);
      expect(authDiscordService.handleDiscordLogin).toHaveBeenCalledWith({
        userDetails: mockUserDetails,
        inviteCode: undefined,
        referralCode: undefined,
      });
      expect(mockReply.redirect).toHaveBeenCalledWith(redirectUrl, 302);
    });

    it("should pass code to exchange for token", async () => {
      const customCode = "custom-discord-code";
      authDiscordService.parseStateData.mockReturnValue(undefined);
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authDiscordService.handleDiscordLogin.mockResolvedValue("http://redirect.url");

      await controller.callbackDiscord(mockReply, customCode);

      expect(authDiscordService.exchangeCodeForToken).toHaveBeenCalledWith(customCode);
    });

    it("should parse state and pass invite code to handleDiscordLogin", async () => {
      const mockState = "encoded-state";
      authDiscordService.parseStateData.mockReturnValue({ invite: "test-invite", referral: undefined });
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authDiscordService.handleDiscordLogin.mockResolvedValue("http://redirect.url");

      await controller.callbackDiscord(mockReply, mockCode, mockState);

      expect(authDiscordService.parseStateData).toHaveBeenCalledWith(mockState);
      expect(authDiscordService.handleDiscordLogin).toHaveBeenCalledWith({
        userDetails: mockUserDetails,
        inviteCode: "test-invite",
        referralCode: undefined,
      });
    });

    it("should parse state and pass referral code to handleDiscordLogin", async () => {
      const mockState = "encoded-state";
      authDiscordService.parseStateData.mockReturnValue({ invite: undefined, referral: "test-referral" });
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authDiscordService.handleDiscordLogin.mockResolvedValue("http://redirect.url");

      await controller.callbackDiscord(mockReply, mockCode, mockState);

      expect(authDiscordService.parseStateData).toHaveBeenCalledWith(mockState);
      expect(authDiscordService.handleDiscordLogin).toHaveBeenCalledWith({
        userDetails: mockUserDetails,
        inviteCode: undefined,
        referralCode: "test-referral",
      });
    });

    it("should parse state and pass both invite and referral codes to handleDiscordLogin", async () => {
      const mockState = "encoded-state";
      authDiscordService.parseStateData.mockReturnValue({ invite: "test-invite", referral: "test-referral" });
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authDiscordService.handleDiscordLogin.mockResolvedValue("http://redirect.url");

      await controller.callbackDiscord(mockReply, mockCode, mockState);

      expect(authDiscordService.handleDiscordLogin).toHaveBeenCalledWith({
        userDetails: mockUserDetails,
        inviteCode: "test-invite",
        referralCode: "test-referral",
      });
    });

    it("should handle token exchange failure", async () => {
      authDiscordService.parseStateData.mockReturnValue(undefined);
      authDiscordService.exchangeCodeForToken.mockRejectedValue(new Error("Invalid code"));

      await expect(controller.callbackDiscord(mockReply, mockCode)).rejects.toThrow("Invalid code");
    });

    it("should handle user details fetch failure", async () => {
      authDiscordService.parseStateData.mockReturnValue(undefined);
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockRejectedValue(new Error("Failed to fetch user"));

      await expect(controller.callbackDiscord(mockReply, mockCode)).rejects.toThrow("Failed to fetch user");
    });

    it("should handle login processing failure", async () => {
      authDiscordService.parseStateData.mockReturnValue(undefined);
      authDiscordService.exchangeCodeForToken.mockResolvedValue(mockAccessToken);
      authDiscordService.fetchUserDetails.mockResolvedValue(mockUserDetails);
      authDiscordService.handleDiscordLogin.mockRejectedValue(new Error("Login failed"));

      await expect(controller.callbackDiscord(mockReply, mockCode)).rejects.toThrow("Login failed");
    });
  });

  describe("signup source", () => {
    it("`source` query param is forwarded to generateLoginUrl", async () => {
      const source = JSON.stringify({ sourceRef: "discord-embed" });
      authDiscordService.generateLoginUrl.mockReturnValue("https://provider.example.com/login");

      await controller.loginWithDiscord(mockReply, "invite-code", "referral-code", source);

      expect(authDiscordService.generateLoginUrl).toHaveBeenCalledWith("invite-code", "referral-code", source);
      expect(mockReply.redirect).toHaveBeenCalledWith("https://provider.example.com/login", 302);
    });

    it("a malformed source does not throw", async () => {
      authDiscordService.generateLoginUrl.mockReturnValue("https://provider.example.com/login");

      await expect(
        controller.loginWithDiscord(mockReply, undefined, undefined, "{not json" + "x".repeat(10240)),
      ).resolves.toBeUndefined();
      expect(mockReply.redirect).toHaveBeenCalledWith("https://provider.example.com/login", 302);
    });

    it("passes the state source to the callback handler", async () => {
      const source = JSON.stringify({ sourceUtmSource: "reddit" });
      authDiscordService.parseStateData.mockReturnValue({ invite: "inv-1", referral: undefined, source });
      authDiscordService.exchangeCodeForToken.mockResolvedValue("access-token");
      authDiscordService.fetchUserDetails.mockResolvedValue({
        id: "provider-user-id",
        email: "test@example.com",
      } as any);
      authDiscordService.handleDiscordLogin.mockResolvedValue("http://redirect.url");

      await controller.callbackDiscord(mockReply, "auth-code", "encoded-state");

      expect(authDiscordService.handleDiscordLogin).toHaveBeenCalledWith(
        expect.objectContaining({ inviteCode: "inv-1", source }),
      );
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
