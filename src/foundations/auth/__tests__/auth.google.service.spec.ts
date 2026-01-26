import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";

// Mock the auth index module to avoid circular dependency issue with authMeta in decorators
vi.mock("..", () => ({
  authMeta: {
    type: "auth",
    endpoint: "auth",
    nodeName: "auth",
    labelName: "Auth",
  },
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

import { AuthGoogleService } from "../services/auth.google.service";
import { AuthService } from "..";
import { UserRepository } from "../../user";
import { GoogleUserRepository } from "../../google-user/repositories/google-user.repository";
import { PendingRegistrationService } from "../services/pending-registration.service";

const mockedAxios = vi.mocked(axios);

// Mock AuthService interface for type checking
interface MockAuthService {
  createToken: ReturnType<typeof vi.fn>;
  createCode: ReturnType<typeof vi.fn>;
}

describe("AuthGoogleService", () => {
  let service: AuthGoogleService;
  let userRepository: MockedObject<UserRepository>;
  let googleUserRepository: MockedObject<GoogleUserRepository>;
  let authService: MockAuthService;
  let configService: MockedObject<ConfigService>;
  let clsService: MockedObject<ClsService>;
  let pendingRegistrationService: MockedObject<PendingRegistrationService>;

  const TEST_IDS = {
    userId: "user-123",
    googleId: "google-456",
    companyId: "company-789",
    authCodeId: "mock-uuid-12345",
    pendingId: "pending-registration-123",
  };

  const mockConfig = {
    google: {
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
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

  const mockGoogleUserDetails = {
    id: TEST_IDS.googleId,
    email: "test@example.com",
    name: "Test User",
    picture: "https://example.com/avatar.png",
  };

  const mockExistingGoogleUser = {
    id: "google-user-id",
    googleId: TEST_IDS.googleId,
    user: {
      id: TEST_IDS.userId,
      name: "Test User",
      email: "test@example.com",
      avatar: "https://example.com/old-avatar.png",
    },
  };

  beforeEach(async () => {
    const mockUserRepository = {
      updateAvatar: vi.fn(),
    };

    const mockGoogleUserRepository = {
      findByGoogleId: vi.fn(),
    };

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
        AuthGoogleService,
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: GoogleUserRepository, useValue: mockGoogleUserRepository },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockClsService },
        { provide: PendingRegistrationService, useValue: mockPendingRegistrationService },
      ],
    }).compile();

    service = module.get<AuthGoogleService>(AuthGoogleService);
    userRepository = module.get(UserRepository);
    googleUserRepository = module.get(GoogleUserRepository);
    authService = module.get(AuthService);
    configService = module.get(ConfigService);
    clsService = module.get(ClsService);
    pendingRegistrationService = module.get(PendingRegistrationService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateLoginUrl", () => {
    it("should return correctly formatted Google OAuth2 URL", () => {
      const result = service.generateLoginUrl();

      expect(result).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
      expect(result).toContain("client_id=google-client-id");
      expect(result).toContain("redirect_uri=http%3A%2F%2Fapi.example.com%2Fauth%2Fcallback%2Fgoogle");
      expect(result).toContain("response_type=code");
    });

    it("should include userinfo scopes", () => {
      const result = service.generateLoginUrl();

      expect(result).toContain("scope=");
      expect(result).toContain("userinfo.email");
      expect(result).toContain("userinfo.profile");
    });

    it("should include access_type=offline", () => {
      const result = service.generateLoginUrl();

      expect(result).toContain("access_type=offline");
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

  describe("handleGoogleLogin", () => {
    describe("existing user", () => {
      it("should return redirect URL with auth code for existing user", async () => {
        googleUserRepository.findByGoogleId.mockResolvedValue(mockExistingGoogleUser as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-123" } },
        } as any);
        authService.createCode.mockResolvedValue(undefined);

        const result = await service.handleGoogleLogin({ userDetails: mockGoogleUserDetails });

        expect(result).toBe("http://app.example.com/auth?code=mock-uuid-12345");
      });

      it("should create token with user from google user", async () => {
        googleUserRepository.findByGoogleId.mockResolvedValue(mockExistingGoogleUser as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-123" } },
        } as any);

        await service.handleGoogleLogin({ userDetails: mockGoogleUserDetails });

        expect(authService.createToken).toHaveBeenCalledWith({ user: mockExistingGoogleUser.user });
      });

      it("should create auth code with refresh token", async () => {
        googleUserRepository.findByGoogleId.mockResolvedValue(mockExistingGoogleUser as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-xyz" } },
        } as any);

        await service.handleGoogleLogin({ userDetails: mockGoogleUserDetails });

        expect(authService.createCode).toHaveBeenCalledWith({
          authCodeId: "mock-uuid-12345",
          authId: "refresh-token-xyz",
        });
      });

      it("should update avatar if user avatar has changed and picture is provided", async () => {
        const userWithDifferentAvatar = {
          ...mockExistingGoogleUser,
          user: { ...mockExistingGoogleUser.user, avatar: "https://example.com/different-avatar.png" },
        };
        googleUserRepository.findByGoogleId.mockResolvedValue(userWithDifferentAvatar as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-123" } },
        } as any);

        await service.handleGoogleLogin({ userDetails: mockGoogleUserDetails });

        expect(userRepository.updateAvatar).toHaveBeenCalledWith({
          userId: TEST_IDS.userId,
          avatar: mockGoogleUserDetails.picture,
        });
      });

      it("should not update avatar if avatar has not changed", async () => {
        const userWithSameAvatar = {
          ...mockExistingGoogleUser,
          user: { ...mockExistingGoogleUser.user, avatar: mockGoogleUserDetails.picture },
        };
        googleUserRepository.findByGoogleId.mockResolvedValue(userWithSameAvatar as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-123" } },
        } as any);

        await service.handleGoogleLogin({ userDetails: mockGoogleUserDetails });

        expect(userRepository.updateAvatar).not.toHaveBeenCalled();
      });

      it("should not update avatar if picture is null", async () => {
        googleUserRepository.findByGoogleId.mockResolvedValue(mockExistingGoogleUser as any);
        authService.createToken.mockResolvedValue({
          data: { attributes: { refreshToken: "refresh-token-123" } },
        } as any);

        const userDetailsWithoutPicture = { ...mockGoogleUserDetails, picture: null };
        await service.handleGoogleLogin({ userDetails: userDetailsWithoutPicture });

        expect(userRepository.updateAvatar).not.toHaveBeenCalled();
      });
    });

    describe("new user", () => {
      it("should create pending registration and return consent URL when registration allowed", async () => {
        googleUserRepository.findByGoogleId.mockResolvedValue(null);
        pendingRegistrationService.create.mockResolvedValue(TEST_IDS.pendingId);

        const result = await service.handleGoogleLogin({ userDetails: mockGoogleUserDetails });

        expect(pendingRegistrationService.create).toHaveBeenCalledWith({
          provider: "google",
          providerUserId: mockGoogleUserDetails.id,
          email: mockGoogleUserDetails.email,
          name: mockGoogleUserDetails.name,
          avatar: mockGoogleUserDetails.picture,
        });
        expect(result).toBe(`http://app.example.com/auth/consent?pending=${TEST_IDS.pendingId}`);
      });

      it("should return error URL when registration is disabled", async () => {
        googleUserRepository.findByGoogleId.mockResolvedValue(null);
        configService.get.mockImplementation((key: string) => {
          if (key === "auth") {
            return { allowRegistration: false };
          }
          return mockConfig[key as keyof typeof mockConfig];
        });

        const result = await service.handleGoogleLogin({ userDetails: mockGoogleUserDetails });

        expect(result).toBe("http://app.example.com/oauth/error?error=registration_disabled");
        expect(pendingRegistrationService.create).not.toHaveBeenCalled();
      });

      it("should return error URL when registration is closed", async () => {
        googleUserRepository.findByGoogleId.mockResolvedValue(null);
        configService.get.mockImplementation((key: string) => {
          if (key === "auth") {
            return { allowRegistration: true, registrationMode: "closed" };
          }
          return mockConfig[key as keyof typeof mockConfig];
        });

        const result = await service.handleGoogleLogin({ userDetails: mockGoogleUserDetails });

        expect(result).toBe("http://app.example.com/oauth/error?error=registration_closed");
        expect(pendingRegistrationService.create).not.toHaveBeenCalled();
      });

      it("should return error URL when waitlist mode is enabled and no invite code", async () => {
        googleUserRepository.findByGoogleId.mockResolvedValue(null);
        configService.get.mockImplementation((key: string) => {
          if (key === "auth") {
            return { allowRegistration: true, registrationMode: "waitlist" };
          }
          return mockConfig[key as keyof typeof mockConfig];
        });

        const result = await service.handleGoogleLogin({ userDetails: mockGoogleUserDetails });

        expect(result).toBe("http://app.example.com/oauth/error?error=waitlist_required");
        expect(pendingRegistrationService.create).not.toHaveBeenCalled();
      });

      it("should proceed to consent page when waitlist mode is enabled with invite code", async () => {
        googleUserRepository.findByGoogleId.mockResolvedValue(null);
        configService.get.mockImplementation((key: string) => {
          if (key === "auth") {
            return { allowRegistration: true, registrationMode: "waitlist" };
          }
          return mockConfig[key as keyof typeof mockConfig];
        });
        pendingRegistrationService.create.mockResolvedValue(TEST_IDS.pendingId);

        const result = await service.handleGoogleLogin({
          userDetails: mockGoogleUserDetails,
          inviteCode: "valid-invite-code",
        });

        expect(pendingRegistrationService.create).toHaveBeenCalledWith({
          provider: "google",
          providerUserId: mockGoogleUserDetails.id,
          email: mockGoogleUserDetails.email,
          name: mockGoogleUserDetails.name,
          avatar: mockGoogleUserDetails.picture,
          inviteCode: "valid-invite-code",
        });
        expect(result).toBe(`http://app.example.com/auth/consent?pending=${TEST_IDS.pendingId}`);
      });
    });
  });

  describe("exchangeCodeForToken", () => {
    const mockCode = "google-auth-code";
    const mockAccessToken = "google-access-token";

    it("should exchange code for access token", async () => {
      mockedAxios.post.mockResolvedValue({ data: { access_token: mockAccessToken } });

      const result = await service.exchangeCodeForToken(mockCode);

      expect(result).toBe(mockAccessToken);
    });

    it("should call Google API with correct parameters", async () => {
      mockedAxios.post.mockResolvedValue({ data: { access_token: mockAccessToken } });

      await service.exchangeCodeForToken(mockCode);

      expect(mockedAxios.post).toHaveBeenCalledWith("https://oauth2.googleapis.com/token", expect.any(String), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
    });

    it("should include client credentials in request", async () => {
      mockedAxios.post.mockResolvedValue({ data: { access_token: mockAccessToken } });

      await service.exchangeCodeForToken(mockCode);

      const [, requestBody] = mockedAxios.post.mock.calls[0];
      expect(requestBody).toContain("client_id=google-client-id");
      expect(requestBody).toContain("client_secret=google-client-secret");
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
      expect(requestBody).toContain("redirect_uri=http%3A%2F%2Fapi.example.com%2Fauth%2Fcallback%2Fgoogle");
    });

    it("should throw error when API request fails", async () => {
      mockedAxios.post.mockRejectedValue(new Error("Google API error"));

      await expect(service.exchangeCodeForToken(mockCode)).rejects.toThrow("Google API error");
    });
  });

  describe("fetchUserDetails", () => {
    const mockAccessToken = "google-access-token";

    it("should fetch user details from Google API", async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          id: TEST_IDS.googleId,
          email: "test@example.com",
          name: "Test User",
          picture: "https://example.com/avatar.png",
        },
      });

      const result = await service.fetchUserDetails(mockAccessToken);

      expect(result).toEqual({
        id: TEST_IDS.googleId,
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/avatar.png",
      });
    });

    it("should call Google API with Bearer token", async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          id: TEST_IDS.googleId,
          email: "test@example.com",
          name: "Test User",
          picture: null,
        },
      });

      await service.fetchUserDetails(mockAccessToken);

      expect(mockedAxios.get).toHaveBeenCalledWith("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: {
          Authorization: `Bearer ${mockAccessToken}`,
        },
      });
    });

    it("should return null picture when user has no picture", async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          id: TEST_IDS.googleId,
          email: "test@example.com",
          name: "Test User",
          picture: undefined,
        },
      });

      const result = await service.fetchUserDetails(mockAccessToken);

      expect(result.picture).toBeNull();
    });

    it("should return picture URL when user has picture", async () => {
      const pictureUrl = "https://example.com/custom-avatar.png";
      mockedAxios.get.mockResolvedValue({
        data: {
          id: TEST_IDS.googleId,
          email: "test@example.com",
          name: "Test User",
          picture: pictureUrl,
        },
      });

      const result = await service.fetchUserDetails(mockAccessToken);

      expect(result.picture).toBe(pictureUrl);
    });

    it("should throw error when API request fails", async () => {
      mockedAxios.get.mockRejectedValue(new Error("Failed to fetch user"));

      await expect(service.fetchUserDetails(mockAccessToken)).rejects.toThrow("Failed to fetch user");
    });
  });

  describe("dependency injection", () => {
    it("should have all dependencies injected", () => {
      expect(service["userRepository"]).toBeDefined();
      expect(service["googleUserRepository"]).toBeDefined();
      expect(service["authService"]).toBeDefined();
      expect(service["config"]).toBeDefined();
      expect(service["clsService"]).toBeDefined();
      expect(service["pendingRegistrationService"]).toBeDefined();
    });
  });
});
