import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";

// Mock the auth index module to avoid circular dependency issue with authMeta in decorators
// This must come before any imports that could trigger the module loading
vi.mock("..", () => ({
  authMeta: {
    type: "auth",
    endpoint: "auth",
    nodeName: "auth",
    labelName: "Auth",
  },
  // Re-export AuthService class - we'll provide mock instance in test
  AuthService: class MockAuthService {
    createToken = vi.fn();
    createCode = vi.fn();
  },
  AuthModule: class {},
  AuthController: class {},
  TrialQueueService: class {},
}));

// Mock axios
vi.mock("axios");

// Mock crypto.randomUUID
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid-12345"),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import axios from "axios";

import { AuthDiscordService } from "../services/auth.discord.service";
import { AuthService } from ".."; // This imports the mocked AuthService
import { UserRepository } from "../../user";
import { DiscordUserRepository } from "../../discord-user/repositories/discord-user.repository";
import { DiscordUserService } from "../../discord-user";
import { PendingRegistrationService } from "../services/pending-registration.service";

const mockedAxios = vi.mocked(axios);

// Mock AuthService interface for type checking
interface MockAuthService {
  createToken: ReturnType<typeof vi.fn>;
  createCode: ReturnType<typeof vi.fn>;
}

describe("AuthDiscordService", () => {
  let service: AuthDiscordService;
  let userRepository: MockedObject<UserRepository>;
  let discordUserRepository: MockedObject<DiscordUserRepository>;
  let discordUserService: MockedObject<DiscordUserService>;
  let authService: MockAuthService;
  let configService: MockedObject<ConfigService>;
  let clsService: MockedObject<ClsService>;
  let pendingRegistrationService: MockedObject<PendingRegistrationService>;

  const TEST_IDS = {
    userId: "user-123",
    discordId: "discord-456",
    companyId: "company-789",
    authCodeId: "mock-uuid-12345",
    pendingId: "pending-registration-123",
  };

  const mockConfig = {
    discord: {
      clientId: "discord-client-id",
      clientSecret: "discord-client-secret",
    },
    api: {
      url: "http://api.example.com/",
    },
    app: {
      url: "http://app.example.com/",
    },
    auth: {
      allowRegistration: true,
    },
  };

  const mockDiscordUserDetails = {
    id: TEST_IDS.discordId,
    email: "test@example.com",
    username: "testuser",
    avatar: "avatar-hash-123",
  };

  const mockExistingDiscordUser = {
    id: "discord-user-id",
    discordId: TEST_IDS.discordId,
    user: {
      id: TEST_IDS.userId,
      name: "Test User",
      email: "test@example.com",
      avatar: "old-avatar-hash",
    },
  };

  beforeEach(async () => {
    const mockUserRepository = {
      updateAvatar: vi.fn(),
    };

    const mockDiscordUserRepository = {
      findByDiscordId: vi.fn(),
    };

    const mockDiscordUserService = {};

    const mockAuthService = {
      createToken: vi.fn(),
      createCode: vi.fn(),
    };

    const mockConfigService = {
      get: vi.fn((key: string) => {
        return mockConfig[key as keyof typeof mockConfig];
      }),
    };

    const mockClsService = {
      get: vi.fn(),
    };

    const mockPendingRegistrationService = {
      create: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthDiscordService,
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: DiscordUserRepository, useValue: mockDiscordUserRepository },
        { provide: DiscordUserService, useValue: mockDiscordUserService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockClsService },
        { provide: PendingRegistrationService, useValue: mockPendingRegistrationService },
      ],
    }).compile();

    service = module.get<AuthDiscordService>(AuthDiscordService);
    userRepository = module.get(UserRepository);
    discordUserRepository = module.get(DiscordUserRepository);
    discordUserService = module.get(DiscordUserService);
    authService = module.get(AuthService);
    configService = module.get(ConfigService);
    clsService = module.get(ClsService);
    pendingRegistrationService = module.get(PendingRegistrationService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateLoginUrl", () => {
    it("should return correctly formatted Discord OAuth2 URL", () => {
      const result = service.generateLoginUrl();

      // URL contains encoded redirect_uri and state parameter
      expect(result).toContain("https://discord.com/api/oauth2/authorize?");
      expect(result).toContain("client_id=discord-client-id");
      expect(result).toContain("redirect_uri=");
      expect(result).toContain("response_type=code");
      expect(result).toContain("scope=identify");
      expect(result).toContain("state=");
    });

    it("should include client_id from config", () => {
      const result = service.generateLoginUrl();

      expect(result).toContain("client_id=discord-client-id");
    });

    it("should include redirect_uri from api config", () => {
      const result = service.generateLoginUrl();

      // URL-encoded redirect_uri
      expect(result).toContain("redirect_uri=http%3A%2F%2Fapi.example.com%2Fauth%2Fcallback%2Fdiscord");
    });

    it("should request identify and email scopes", () => {
      const result = service.generateLoginUrl();

      // URLSearchParams encodes space as +
      expect(result).toContain("scope=identify+email");
    });

    it("should include state parameter with nonce", () => {
      const result = service.generateLoginUrl();

      expect(result).toContain("state=");
      // State is base64url encoded JSON containing nonce
      const stateMatch = result.match(/state=([^&]+)/);
      expect(stateMatch).toBeTruthy();
      const stateData = JSON.parse(Buffer.from(stateMatch![1], "base64url").toString());
      expect(stateData.nonce).toBe("mock-uuid-12345");
    });

    it("should include invite code in state when provided", () => {
      const result = service.generateLoginUrl("test-invite-code");

      const stateMatch = result.match(/state=([^&]+)/);
      expect(stateMatch).toBeTruthy();
      const stateData = JSON.parse(Buffer.from(stateMatch![1], "base64url").toString());
      expect(stateData.invite).toBe("test-invite-code");
    });
  });

  describe("handleDiscordLogin", () => {
    describe("existing user", () => {
      it("should return redirect URL with auth code for existing user", async () => {
        discordUserRepository.findByDiscordId.mockResolvedValue(mockExistingDiscordUser as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-123" } },
        } as any);
        authService.createCode.mockResolvedValue(undefined);

        const result = await service.handleDiscordLogin({ userDetails: mockDiscordUserDetails });

        expect(result).toBe("http://app.example.com/auth?code=mock-uuid-12345");
      });

      it("should create token with user from discord user", async () => {
        discordUserRepository.findByDiscordId.mockResolvedValue(mockExistingDiscordUser as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-123" } },
        } as any);

        await service.handleDiscordLogin({ userDetails: mockDiscordUserDetails });

        expect(authService.createToken).toHaveBeenCalledWith({ user: mockExistingDiscordUser.user });
      });

      it("should create auth code with refresh token", async () => {
        discordUserRepository.findByDiscordId.mockResolvedValue(mockExistingDiscordUser as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-xyz" } },
        } as any);

        await service.handleDiscordLogin({ userDetails: mockDiscordUserDetails });

        expect(authService.createCode).toHaveBeenCalledWith({
          authCodeId: "mock-uuid-12345",
          authId: "refresh-token-xyz",
        });
      });

      it("should update avatar if user avatar has changed", async () => {
        const userWithDifferentAvatar = {
          ...mockExistingDiscordUser,
          user: { ...mockExistingDiscordUser.user, avatar: "different-avatar" },
        };
        discordUserRepository.findByDiscordId.mockResolvedValue(userWithDifferentAvatar as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-123" } },
        } as any);

        await service.handleDiscordLogin({ userDetails: mockDiscordUserDetails });

        expect(userRepository.updateAvatar).toHaveBeenCalledWith({
          userId: TEST_IDS.userId,
          avatar: mockDiscordUserDetails.avatar,
        });
      });

      it("should not update avatar if avatar has not changed", async () => {
        const userWithSameAvatar = {
          ...mockExistingDiscordUser,
          user: { ...mockExistingDiscordUser.user, avatar: mockDiscordUserDetails.avatar },
        };
        discordUserRepository.findByDiscordId.mockResolvedValue(userWithSameAvatar as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-123" } },
        } as any);

        await service.handleDiscordLogin({ userDetails: mockDiscordUserDetails });

        expect(userRepository.updateAvatar).not.toHaveBeenCalled();
      });
    });

    describe("new user", () => {
      it("should create pending registration and return consent URL when registration allowed", async () => {
        discordUserRepository.findByDiscordId.mockResolvedValue(null);
        pendingRegistrationService.create.mockResolvedValue(TEST_IDS.pendingId);

        const result = await service.handleDiscordLogin({ userDetails: mockDiscordUserDetails });

        expect(pendingRegistrationService.create).toHaveBeenCalledWith({
          provider: "discord",
          providerUserId: mockDiscordUserDetails.id,
          email: mockDiscordUserDetails.email,
          name: mockDiscordUserDetails.username,
          avatar: mockDiscordUserDetails.avatar,
        });
        expect(result).toBe(`http://app.example.com/auth/consent?pending=${TEST_IDS.pendingId}`);
      });

      it("should return error URL when registration is disabled", async () => {
        discordUserRepository.findByDiscordId.mockResolvedValue(null);
        // Override config to disable registration
        configService.get.mockImplementation((key: string) => {
          if (key === "auth") {
            return { allowRegistration: false };
          }
          return mockConfig[key as keyof typeof mockConfig];
        });

        const result = await service.handleDiscordLogin({ userDetails: mockDiscordUserDetails });

        expect(result).toBe("http://app.example.com/oauth/error?error=registration_disabled");
        expect(pendingRegistrationService.create).not.toHaveBeenCalled();
      });

      it("should return error URL when registration is closed", async () => {
        discordUserRepository.findByDiscordId.mockResolvedValue(null);
        configService.get.mockImplementation((key: string) => {
          if (key === "auth") {
            return { allowRegistration: true, registrationMode: "closed" };
          }
          return mockConfig[key as keyof typeof mockConfig];
        });

        const result = await service.handleDiscordLogin({ userDetails: mockDiscordUserDetails });

        expect(result).toBe("http://app.example.com/oauth/error?error=registration_closed");
        expect(pendingRegistrationService.create).not.toHaveBeenCalled();
      });

      it("should return error URL when waitlist mode is enabled and no invite code", async () => {
        discordUserRepository.findByDiscordId.mockResolvedValue(null);
        configService.get.mockImplementation((key: string) => {
          if (key === "auth") {
            return { allowRegistration: true, registrationMode: "waitlist" };
          }
          return mockConfig[key as keyof typeof mockConfig];
        });

        const result = await service.handleDiscordLogin({ userDetails: mockDiscordUserDetails });

        expect(result).toBe("http://app.example.com/oauth/error?error=waitlist_required");
        expect(pendingRegistrationService.create).not.toHaveBeenCalled();
      });

      it("should proceed to consent page when waitlist mode is enabled with invite code", async () => {
        discordUserRepository.findByDiscordId.mockResolvedValue(null);
        configService.get.mockImplementation((key: string) => {
          if (key === "auth") {
            return { allowRegistration: true, registrationMode: "waitlist" };
          }
          return mockConfig[key as keyof typeof mockConfig];
        });
        pendingRegistrationService.create.mockResolvedValue(TEST_IDS.pendingId);

        const result = await service.handleDiscordLogin({
          userDetails: mockDiscordUserDetails,
          inviteCode: "valid-invite-code",
        });

        expect(pendingRegistrationService.create).toHaveBeenCalledWith({
          provider: "discord",
          providerUserId: mockDiscordUserDetails.id,
          email: mockDiscordUserDetails.email,
          name: mockDiscordUserDetails.username,
          avatar: mockDiscordUserDetails.avatar,
          inviteCode: "valid-invite-code",
        });
        expect(result).toBe(`http://app.example.com/auth/consent?pending=${TEST_IDS.pendingId}`);
      });
    });
  });

  describe("exchangeCodeForToken", () => {
    const mockCode = "discord-auth-code";
    const mockAccessToken = "discord-access-token";

    it("should exchange code for access token", async () => {
      mockedAxios.post.mockResolvedValue({ data: { access_token: mockAccessToken } });

      const result = await service.exchangeCodeForToken(mockCode);

      expect(result).toBe(mockAccessToken);
    });

    it("should call Discord API with correct parameters", async () => {
      mockedAxios.post.mockResolvedValue({ data: { access_token: mockAccessToken } });

      await service.exchangeCodeForToken(mockCode);

      expect(mockedAxios.post).toHaveBeenCalledWith("https://discord.com/api/oauth2/token", expect.any(String), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
    });

    it("should include client credentials in request", async () => {
      mockedAxios.post.mockResolvedValue({ data: { access_token: mockAccessToken } });

      await service.exchangeCodeForToken(mockCode);

      const [, requestBody] = mockedAxios.post.mock.calls[0];
      expect(requestBody).toContain("client_id=discord-client-id");
      expect(requestBody).toContain("client_secret=discord-client-secret");
    });

    it("should include grant_type and code in request", async () => {
      mockedAxios.post.mockResolvedValue({ data: { access_token: mockAccessToken } });

      await service.exchangeCodeForToken(mockCode);

      const [, requestBody] = mockedAxios.post.mock.calls[0];
      expect(requestBody).toContain("grant_type=authorization_code");
      expect(requestBody).toContain(`code=${mockCode}`);
    });

    it("should include redirect_uri in request", async () => {
      mockedAxios.post.mockResolvedValue({ data: { access_token: mockAccessToken } });

      await service.exchangeCodeForToken(mockCode);

      const [, requestBody] = mockedAxios.post.mock.calls[0];
      expect(requestBody).toContain("redirect_uri=http%3A%2F%2Fapi.example.com%2Fauth%2Fcallback%2Fdiscord");
    });

    it("should throw error when API request fails", async () => {
      mockedAxios.post.mockRejectedValue(new Error("Discord API error"));

      await expect(service.exchangeCodeForToken(mockCode)).rejects.toThrow("Discord API error");
    });
  });

  describe("fetchUserDetails", () => {
    const mockAccessToken = "discord-access-token";

    it("should fetch user details from Discord API", async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          id: TEST_IDS.discordId,
          email: "test@example.com",
          username: "testuser",
          avatar: "avatar-hash",
        },
      });

      const result = await service.fetchUserDetails(mockAccessToken);

      expect(result).toEqual({
        id: TEST_IDS.discordId,
        email: "test@example.com",
        username: "testuser",
        avatar: `~https://cdn.discordapp.com/avatars/${TEST_IDS.discordId}/avatar-hash.png`,
      });
    });

    it("should call Discord API with Bearer token", async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          id: TEST_IDS.discordId,
          email: "test@example.com",
          username: "testuser",
          avatar: null,
        },
      });

      await service.fetchUserDetails(mockAccessToken);

      expect(mockedAxios.get).toHaveBeenCalledWith("https://discord.com/api/users/@me", {
        headers: {
          Authorization: `Bearer ${mockAccessToken}`,
        },
      });
    });

    it("should return null avatar when user has no avatar", async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          id: TEST_IDS.discordId,
          email: "test@example.com",
          username: "testuser",
          avatar: null,
        },
      });

      const result = await service.fetchUserDetails(mockAccessToken);

      expect(result.avatar).toBeNull();
    });

    it("should construct avatar URL correctly when avatar exists", async () => {
      const avatarHash = "custom-avatar-hash";
      mockedAxios.get.mockResolvedValue({
        data: {
          id: TEST_IDS.discordId,
          email: "test@example.com",
          username: "testuser",
          avatar: avatarHash,
        },
      });

      const result = await service.fetchUserDetails(mockAccessToken);

      expect(result.avatar).toBe(`~https://cdn.discordapp.com/avatars/${TEST_IDS.discordId}/${avatarHash}.png`);
    });

    it("should throw error when API request fails", async () => {
      mockedAxios.get.mockRejectedValue(new Error("Failed to fetch user"));

      await expect(service.fetchUserDetails(mockAccessToken)).rejects.toThrow("Failed to fetch user");
    });
  });

  describe("dependency injection", () => {
    it("should have all dependencies injected", () => {
      expect(service["userRepository"]).toBeDefined();
      expect(service["discordUserRepository"]).toBeDefined();
      expect(service["discordUserService"]).toBeDefined();
      expect(service["authService"]).toBeDefined();
      expect(service["config"]).toBeDefined();
      expect(service["clsService"]).toBeDefined();
      expect(service["pendingRegistrationService"]).toBeDefined();
    });
  });
});
