import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { AuthService } from "../../auth/services/auth.service";
import { AuthRepository } from "../../auth/repositories/auth.repository";
import { UserRepository } from "../../user/repositories/user.repository";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { UserService } from "../../user/services/user.service";
import { EmailService } from "../../../core/email/services/email.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { PendingRegistrationService } from "../../auth/services/pending-registration.service";
import { DiscordUserService } from "../../discord-user/services/discord-user.service";
import { GoogleUserService } from "../../google-user/services/google-user.service";
import { TrialQueueService } from "../../auth/services/trial-queue.service";
import { WaitlistService } from "../../waitlist/services/waitlist.service";
import { TwoFactorService } from "../services/two-factor.service";
import { Auth } from "../../auth/entities/auth.entity";
import { User } from "../../user/entities/user";

// Mock crypto
vi.mock("crypto", async () => {
  const actual = await vi.importActual("crypto");
  return {
    ...actual,
    randomUUID: () => "mock-random-uuid",
  };
});

// Mock security functions
vi.mock("../../../core/security/services/security.service", async () => {
  const actual = await vi.importActual("../../../core/security/services/security.service");
  return {
    ...actual,
    hashPassword: vi.fn().mockResolvedValue("hashed-password"),
    checkPassword: vi.fn().mockResolvedValue(true),
  };
});

import { checkPassword } from "../../../core/security/services/security.service";

/**
 * These tests focus on the 2FA integration in the AuthService.
 * They test:
 * 1. Login flow with 2FA enabled - returns pending auth requiring verification
 * 2. completeTwoFactorLogin - completes login after 2FA verification
 */
describe("AuthService - 2FA Integration", () => {
  let service: AuthService;
  let mockJsonApiService: MockedObject<JsonApiService>;
  let mockAuthRepository: MockedObject<AuthRepository>;
  let mockUserRepository: MockedObject<UserRepository>;
  let mockCompanyRepository: MockedObject<CompanyRepository>;
  let mockUserService: MockedObject<UserService>;
  let mockSecurityService: MockedObject<SecurityService>;
  let mockEmailService: MockedObject<EmailService>;
  let mockNeo4jService: MockedObject<Neo4jService>;
  let mockConfigService: MockedObject<ConfigService>;
  let mockClsService: MockedObject<ClsService>;
  let mockModuleRef: MockedObject<ModuleRef>;
  let mockPendingRegistrationService: MockedObject<PendingRegistrationService>;
  let mockDiscordUserService: MockedObject<DiscordUserService>;
  let mockGoogleUserService: MockedObject<GoogleUserService>;
  let mockTrialQueueService: MockedObject<TrialQueueService>;
  let mockWaitlistService: MockedObject<WaitlistService>;
  let mockTwoFactorService: MockedObject<TwoFactorService>;

  const TEST_IDS = {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    authId: "770e8400-e29b-41d4-a716-446655440002",
    roleId: "880e8400-e29b-41d4-a716-446655440003",
    featureId: "990e8400-e29b-41d4-a716-446655440004",
    pendingId: "pending-123",
  };

  const MOCK_USER: User = {
    id: TEST_IDS.userId,
    email: "test@example.com",
    name: "Test User",
    password: "hashed-password",
    isActive: true,
    isDeleted: false,
    code: "activation-code",
    codeExpiration: new Date(Date.now() + 3600000),
    role: [{ id: TEST_IDS.roleId, name: "Admin" }],
    company: {
      id: TEST_IDS.companyId,
      name: "Test Company",
      feature: [{ id: TEST_IDS.featureId, name: "Feature1" }],
    },
  } as User;

  const MOCK_AUTH: Auth = {
    id: TEST_IDS.authId,
    refreshTokenExpiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    user: MOCK_USER,
  } as Auth;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockJsonApiService = {
      buildSingle: vi.fn().mockImplementation((model, data) => ({ data })),
      buildList: vi.fn().mockImplementation((model, data) => ({ data })),
    } as any;

    mockAuthRepository = {
      findByUserId: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(MOCK_AUTH),
      update: vi.fn().mockResolvedValue(MOCK_AUTH),
      findByRefreshToken: vi.fn(),
      deleteByRefreshToken: vi.fn(),
      findByCode: vi.fn(),
      setLastLogin: vi.fn().mockResolvedValue(undefined),
    } as any;

    mockUserRepository = {
      findByUserId: vi.fn().mockResolvedValue(MOCK_USER),
      findForTwoFactorLogin: vi.fn().mockResolvedValue(MOCK_USER),
      findByEmail: vi.fn().mockResolvedValue(MOCK_USER),
      findByResetCode: vi.fn(),
      updatePassword: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    } as any;

    mockCompanyRepository = {
      create: vi.fn(),
    } as any;

    mockUserService = {
      findOne: vi.fn().mockResolvedValue(MOCK_USER),
      create: vi.fn(),
    } as any;

    mockSecurityService = {
      signJwt: vi.fn().mockReturnValue("jwt-token"),
      signPendingJwt: vi.fn().mockReturnValue("pending-jwt-token"),
      refreshTokenExpiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    } as any;

    mockEmailService = {
      sendEmail: vi.fn().mockResolvedValue(undefined),
    } as any;

    mockNeo4jService = {
      write: vi.fn().mockResolvedValue({}),
    } as any;

    mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === "auth") {
          return { allowRegistration: true, registrationMode: "open" };
        }
        if (key === "app") {
          return { url: "http://localhost:3000/" };
        }
        return {};
      }),
    } as any;

    mockClsService = {
      get: vi.fn().mockReturnValue(TEST_IDS.userId),
      set: vi.fn(),
    } as any;

    mockModuleRef = {} as any;

    mockPendingRegistrationService = {
      get: vi.fn(),
      delete: vi.fn(),
    } as any;

    mockDiscordUserService = {
      create: vi.fn(),
    } as any;

    mockGoogleUserService = {
      create: vi.fn(),
    } as any;

    mockTrialQueueService = {
      queueTrial: vi.fn(),
    } as any;

    mockWaitlistService = {
      validateInviteCode: vi.fn(),
      markAsRegistered: vi.fn(),
    } as any;

    mockTwoFactorService = {
      getConfig: vi.fn().mockResolvedValue(null),
      createPendingSession: vi.fn().mockResolvedValue({
        pendingId: TEST_IDS.pendingId,
        expiration: new Date(Date.now() + 300000),
      }),
      getAvailableMethods: vi.fn().mockResolvedValue(["totp", "passkey"]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: mockAuthRepository },
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: CompanyRepository, useValue: mockCompanyRepository },
        { provide: UserService, useValue: mockUserService },
        { provide: JsonApiService, useValue: mockJsonApiService },
        { provide: SecurityService, useValue: mockSecurityService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockClsService },
        { provide: ModuleRef, useValue: mockModuleRef },
        { provide: PendingRegistrationService, useValue: mockPendingRegistrationService },
        { provide: DiscordUserService, useValue: mockDiscordUserService },
        { provide: GoogleUserService, useValue: mockGoogleUserService },
        { provide: TrialQueueService, useValue: mockTrialQueueService },
        { provide: WaitlistService, useValue: mockWaitlistService },
        { provide: TwoFactorService, useValue: mockTwoFactorService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("login with 2FA enabled", () => {
    it("should return pending auth when user has 2FA enabled", async () => {
      (checkPassword as any).mockResolvedValue(true);

      // Mock 2FA enabled
      mockTwoFactorService.getConfig.mockResolvedValue({
        id: "config-123",
        isEnabled: true,
        preferredMethod: "totp",
      });

      const result = await service.login({
        data: {
          type: "auths",
          attributes: {
            email: "test@example.com",
            password: "correctpassword",
          },
        },
      });

      expect(mockTwoFactorService.getConfig).toHaveBeenCalledWith(TEST_IDS.userId);
      expect(mockTwoFactorService.createPendingSession).toHaveBeenCalledWith(TEST_IDS.userId);
      expect(mockTwoFactorService.getAvailableMethods).toHaveBeenCalledWith(TEST_IDS.userId);
      expect(mockSecurityService.signPendingJwt).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        pendingId: TEST_IDS.pendingId,
      });
      expect(result.data).toHaveProperty("id", TEST_IDS.pendingId);
      expect(result.data).toHaveProperty("token", "pending-jwt-token");
      expect(result.data).toHaveProperty("availableMethods");
      expect(result.data).toHaveProperty("preferredMethod", "totp");
    });

    it("should return full auth token when user has 2FA disabled", async () => {
      (checkPassword as any).mockResolvedValue(true);

      // Mock 2FA disabled
      mockTwoFactorService.getConfig.mockResolvedValue(null);

      const result = await service.login({
        data: {
          type: "auths",
          attributes: {
            email: "test@example.com",
            password: "correctpassword",
          },
        },
      });

      expect(mockTwoFactorService.getConfig).toHaveBeenCalledWith(TEST_IDS.userId);
      expect(mockTwoFactorService.createPendingSession).not.toHaveBeenCalled();
      expect(mockSecurityService.signPendingJwt).not.toHaveBeenCalled();
      // Normal login should sign regular JWT
      expect(mockSecurityService.signJwt).toHaveBeenCalled();
    });

    it("should return full auth when 2FA config exists but is disabled", async () => {
      (checkPassword as any).mockResolvedValue(true);

      // Mock 2FA config exists but disabled
      mockTwoFactorService.getConfig.mockResolvedValue({
        id: "config-123",
        isEnabled: false,
        preferredMethod: "totp",
      });

      const result = await service.login({
        data: {
          type: "auths",
          attributes: {
            email: "test@example.com",
            password: "correctpassword",
          },
        },
      });

      expect(mockTwoFactorService.createPendingSession).not.toHaveBeenCalled();
      expect(mockSecurityService.signJwt).toHaveBeenCalled();
    });
  });

  describe("completeTwoFactorLogin", () => {
    it("should complete login and return full auth token", async () => {
      const result = await service.completeTwoFactorLogin(TEST_IDS.userId);

      expect(mockUserRepository.findForTwoFactorLogin).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(mockAuthRepository.setLastLogin).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(mockSecurityService.signJwt).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw NOT_FOUND when user does not exist", async () => {
      mockUserRepository.findForTwoFactorLogin.mockResolvedValue(null);

      await expect(service.completeTwoFactorLogin(TEST_IDS.userId)).rejects.toThrow(HttpException);
    });

    it("should throw FORBIDDEN when user is deleted", async () => {
      mockUserRepository.findForTwoFactorLogin.mockResolvedValue({
        ...MOCK_USER,
        isDeleted: true,
      });

      await expect(service.completeTwoFactorLogin(TEST_IDS.userId)).rejects.toThrow(HttpException);
    });

    it("should throw FORBIDDEN when user is not active", async () => {
      mockUserRepository.findForTwoFactorLogin.mockResolvedValue({
        ...MOCK_USER,
        isActive: false,
      });

      await expect(service.completeTwoFactorLogin(TEST_IDS.userId)).rejects.toThrow(HttpException);
    });

    it("should create new auth token regardless of existing auth", async () => {
      // The implementation always creates a new auth, it doesn't update existing ones

      const result = await service.completeTwoFactorLogin(TEST_IDS.userId);

      // createAuth always calls repository.create, not update
      expect(mockAuthRepository.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should set CLS context for company", async () => {
      await service.completeTwoFactorLogin(TEST_IDS.userId);

      expect(mockClsService.set).toHaveBeenCalledWith("companyId", TEST_IDS.companyId);
      expect(mockClsService.set).toHaveBeenCalledWith("userId", TEST_IDS.userId);
    });
  });

  describe("login validation with 2FA", () => {
    it("should validate password before checking 2FA", async () => {
      (checkPassword as any).mockResolvedValue(false);

      // 2FA enabled
      mockTwoFactorService.getConfig.mockResolvedValue({
        id: "config-123",
        isEnabled: true,
        preferredMethod: "totp",
      });

      // Login with wrong password should fail before 2FA check
      await expect(
        service.login({
          data: {
            type: "auths",
            attributes: {
              email: "test@example.com",
              password: "wrongpassword",
            },
          },
        }),
      ).rejects.toThrow();

      // Should not reach 2FA session creation
      expect(mockTwoFactorService.createPendingSession).not.toHaveBeenCalled();
    });

    it("should throw when user is not found before checking 2FA", async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({
          data: {
            type: "auths",
            attributes: {
              email: "nonexistent@example.com",
              password: "password",
            },
          },
        }),
      ).rejects.toThrow();

      expect(mockTwoFactorService.getConfig).not.toHaveBeenCalled();
    });
  });
});
