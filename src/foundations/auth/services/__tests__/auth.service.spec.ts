import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { AuthService } from "../auth.service";
import { AuthRepository } from "../../repositories/auth.repository";
import { UserRepository } from "../../../user/repositories/user.repository";
import { CompanyRepository } from "../../../company/repositories/company.repository";
import { UserService } from "../../../user/services/user.service";
import { EmailService } from "../../../../core/email/services/email.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { PendingRegistrationService } from "../pending-registration.service";
import { DiscordUserService } from "../../../discord-user/services/discord-user.service";
import { GoogleUserService } from "../../../google-user/services/google-user.service";
import { TrialQueueService } from "../trial-queue.service";
import { WaitlistService } from "../../../waitlist/services/waitlist.service";
import { Auth } from "../../entities/auth.entity";
import { AuthCode } from "../../entities/auth.code.entity";
import { User } from "../../../user/entities/user";

// Mock crypto
vi.mock("crypto", async () => {
  const actual = await vi.importActual("crypto");
  return {
    ...actual,
    randomUUID: () => "mock-random-uuid",
  };
});

// Mock security functions
vi.mock("../../../../core/security/services/security.service", async () => {
  const actual = await vi.importActual("../../../../core/security/services/security.service");
  return {
    ...actual,
    hashPassword: vi.fn().mockResolvedValue("hashed-password"),
    checkPassword: vi.fn().mockResolvedValue(true),
  };
});

// Import mocked functions
import { hashPassword, checkPassword } from "../../../../core/security/services/security.service";

describe("AuthService", () => {
  let service: AuthService;
  let jsonApiService: MockedObject<JsonApiService>;
  let authRepository: MockedObject<AuthRepository>;
  let userService: MockedObject<UserService>;
  let userRepository: MockedObject<UserRepository>;
  let companyRepository: MockedObject<CompanyRepository>;
  let emailService: MockedObject<EmailService>;
  let securityService: MockedObject<SecurityService>;
  let clsService: MockedObject<ClsService>;
  let neo4jService: MockedObject<Neo4jService>;
  let moduleRef: MockedObject<ModuleRef>;
  let configService: MockedObject<ConfigService>;
  let pendingRegistrationService: MockedObject<PendingRegistrationService>;
  let discordUserService: MockedObject<DiscordUserService>;
  let googleUserService: MockedObject<GoogleUserService>;
  let trialQueueService: MockedObject<TrialQueueService>;
  let waitlistService: MockedObject<WaitlistService>;

  const TEST_IDS = {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    authId: "770e8400-e29b-41d4-a716-446655440002",
    roleId: "880e8400-e29b-41d4-a716-446655440003",
    featureId: "990e8400-e29b-41d4-a716-446655440004",
  };

  const MOCK_AUTH_CONFIG = {
    allowRegistration: true,
  };

  const MOCK_APP_CONFIG = {
    url: "https://example.com/",
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
    token: "jwt-token",
    expiration: new Date(Date.now() + 3600000),
    user: MOCK_USER,
  } as Auth;

  const MOCK_AUTH_CODE: AuthCode = {
    id: "auth-code-123",
    expiration: new Date(Date.now() + 300000),
    auth: MOCK_AUTH,
  } as AuthCode;

  const createMockJsonApiService = () => ({
    buildSingle: vi.fn(),
    buildMany: vi.fn(),
  });

  const createMockAuthRepository = () => ({
    create: vi.fn(),
    findByToken: vi.fn(),
    findByRefreshToken: vi.fn(),
    findById: vi.fn(),
    findByCode: vi.fn(),
    findUserById: vi.fn(),
    createCode: vi.fn(),
    setLastLogin: vi.fn(),
    deleteByToken: vi.fn(),
    deleteExpiredAuths: vi.fn(),
    refreshToken: vi.fn(),
    startResetPassword: vi.fn(),
    resetPassword: vi.fn(),
    acceptInvitation: vi.fn(),
    activateAccount: vi.fn(),
  });

  const createMockUserService = () => ({
    expectNotExists: vi.fn(),
  });

  const createMockUserRepository = () => ({
    create: vi.fn(),
    findByEmail: vi.fn(),
    findByCode: vi.fn(),
    findByUserId: vi.fn(),
  });

  const createMockCompanyRepository = () => ({
    createByName: vi.fn(),
  });

  const createMockEmailService = () => ({
    sendEmail: vi.fn(),
  });

  const createMockSecurityService = () => ({
    signJwt: vi.fn().mockReturnValue("jwt-token"),
    refreshTokenExpiration: new Date(Date.now() + 3600000),
  });

  const createMockClsService = () => ({
    get: vi.fn(),
    set: vi.fn(),
  });

  const createMockNeo4jService = () => ({});

  const createMockModuleRef = () => ({
    get: vi.fn(),
  });

  const createMockConfigService = () => ({
    get: vi.fn((key: string) => {
      if (key === "auth") return MOCK_AUTH_CONFIG;
      if (key === "app") return MOCK_APP_CONFIG;
      return undefined;
    }),
  });

  const createMockPendingRegistrationService = () => ({
    get: vi.fn(),
    delete: vi.fn(),
  });

  const createMockDiscordUserService = () => ({
    create: vi.fn(),
  });

  const createMockGoogleUserService = () => ({
    create: vi.fn(),
  });

  const createMockTrialQueueService = () => ({
    queueTrialCreation: vi.fn(),
  });

  const createMockWaitlistService = () => ({
    validateInviteCode: vi.fn(),
    markAsRegistered: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JsonApiService, useValue: createMockJsonApiService() },
        { provide: AuthRepository, useValue: createMockAuthRepository() },
        { provide: UserService, useValue: createMockUserService() },
        { provide: UserRepository, useValue: createMockUserRepository() },
        { provide: CompanyRepository, useValue: createMockCompanyRepository() },
        { provide: EmailService, useValue: createMockEmailService() },
        { provide: SecurityService, useValue: createMockSecurityService() },
        { provide: ClsService, useValue: createMockClsService() },
        { provide: Neo4jService, useValue: createMockNeo4jService() },
        { provide: ModuleRef, useValue: createMockModuleRef() },
        { provide: ConfigService, useValue: createMockConfigService() },
        { provide: PendingRegistrationService, useValue: createMockPendingRegistrationService() },
        { provide: DiscordUserService, useValue: createMockDiscordUserService() },
        { provide: GoogleUserService, useValue: createMockGoogleUserService() },
        { provide: TrialQueueService, useValue: createMockTrialQueueService() },
        { provide: WaitlistService, useValue: createMockWaitlistService() },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jsonApiService = module.get(JsonApiService) as MockedObject<JsonApiService>;
    authRepository = module.get(AuthRepository) as MockedObject<AuthRepository>;
    userService = module.get(UserService) as MockedObject<UserService>;
    userRepository = module.get(UserRepository) as MockedObject<UserRepository>;
    companyRepository = module.get(CompanyRepository) as MockedObject<CompanyRepository>;
    emailService = module.get(EmailService) as MockedObject<EmailService>;
    securityService = module.get(SecurityService) as MockedObject<SecurityService>;
    clsService = module.get(ClsService) as MockedObject<ClsService>;
    neo4jService = module.get(Neo4jService) as MockedObject<Neo4jService>;
    moduleRef = module.get(ModuleRef) as MockedObject<ModuleRef>;
    configService = module.get(ConfigService) as MockedObject<ConfigService>;
    pendingRegistrationService = module.get(PendingRegistrationService) as MockedObject<PendingRegistrationService>;
    discordUserService = module.get(DiscordUserService) as MockedObject<DiscordUserService>;
    googleUserService = module.get(GoogleUserService) as MockedObject<GoogleUserService>;
    trialQueueService = module.get(TrialQueueService) as MockedObject<TrialQueueService>;
    waitlistService = module.get(WaitlistService) as MockedObject<WaitlistService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("findCurrentAuth", () => {
    it("should find auth by token from CLS service", async () => {
      // Arrange
      const token = "current-jwt-token";
      clsService.get.mockReturnValue(token);
      authRepository.findByToken.mockResolvedValue(MOCK_AUTH);
      jsonApiService.buildSingle.mockResolvedValue({ data: { type: "auths", id: TEST_IDS.authId } });

      // Act
      const result = await service.findCurrentAuth();

      // Assert
      expect(clsService.get).toHaveBeenCalledWith("token");
      expect(authRepository.findByToken).toHaveBeenCalledWith({ token });
      expect(result).toEqual({ data: { type: "auths", id: TEST_IDS.authId } });
    });

    it("should throw NOT_FOUND when auth not found", async () => {
      // Arrange
      clsService.get.mockReturnValue("invalid-token");
      authRepository.findByToken.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findCurrentAuth()).rejects.toThrow(
        new HttpException("Auth not found", HttpStatus.NOT_FOUND),
      );
    });
  });

  describe("createAuth", () => {
    it("should create auth with user and set refreshToken", async () => {
      // Arrange
      authRepository.create.mockResolvedValue(MOCK_AUTH);
      authRepository.setLastLogin.mockResolvedValue(undefined);

      // Act
      const result = await service.createAuth({ user: MOCK_USER });

      // Assert
      expect(securityService.signJwt).toHaveBeenCalledWith({
        userId: MOCK_USER.id,
        roles: [TEST_IDS.roleId],
        companyId: TEST_IDS.companyId,
        features: [TEST_IDS.featureId],
        userName: MOCK_USER.name,
      });
      expect(authRepository.create).toHaveBeenCalled();
      expect(authRepository.setLastLogin).toHaveBeenCalledWith({ userId: MOCK_USER.id });
      expect((result as any).refreshToken).toBe(MOCK_AUTH.id);
    });

    it("should clear user when refreshToken is provided", async () => {
      // Arrange
      const authWithUser = { ...MOCK_AUTH };
      authRepository.create.mockResolvedValue(authWithUser);
      authRepository.setLastLogin.mockResolvedValue(undefined);

      // Act
      const result = await service.createAuth({ user: MOCK_USER, refreshToken: "existing-refresh-token" });

      // Assert
      expect(result.user).toBeUndefined();
    });

    it("should handle user without roles", async () => {
      // Arrange
      const userWithoutRoles = { ...MOCK_USER, role: undefined };
      authRepository.create.mockResolvedValue(MOCK_AUTH);
      authRepository.setLastLogin.mockResolvedValue(undefined);

      // Act
      await service.createAuth({ user: userWithoutRoles as User });

      // Assert
      expect(securityService.signJwt).toHaveBeenCalledWith(
        expect.objectContaining({
          roles: [],
        }),
      );
    });

    it("should handle user without company features", async () => {
      // Arrange
      const userWithoutFeatures = {
        ...MOCK_USER,
        company: { id: TEST_IDS.companyId, name: "Test", feature: undefined },
      };
      authRepository.create.mockResolvedValue(MOCK_AUTH);
      authRepository.setLastLogin.mockResolvedValue(undefined);

      // Act
      await service.createAuth({ user: userWithoutFeatures as User });

      // Assert
      expect(securityService.signJwt).toHaveBeenCalledWith(
        expect.objectContaining({
          features: [],
        }),
      );
    });
  });

  describe("createToken", () => {
    it("should create token and set CLS context", async () => {
      // Arrange
      authRepository.create.mockResolvedValue(MOCK_AUTH);
      authRepository.setLastLogin.mockResolvedValue(undefined);
      jsonApiService.buildSingle.mockResolvedValue({ data: { type: "auths" } });

      // Act
      const result = await service.createToken({ user: MOCK_USER });

      // Assert
      expect(clsService.set).toHaveBeenCalledWith("companyId", TEST_IDS.companyId);
      expect(clsService.set).toHaveBeenCalledWith("userId", MOCK_USER.id);
      expect(result).toEqual({ data: { type: "auths" } });
    });

    it("should not set CLS context when user has no company", async () => {
      // Arrange
      const userWithoutCompany = { ...MOCK_USER, company: undefined };
      const authWithoutCompany = { ...MOCK_AUTH, user: userWithoutCompany };
      authRepository.create.mockResolvedValue(authWithoutCompany);
      authRepository.setLastLogin.mockResolvedValue(undefined);
      jsonApiService.buildSingle.mockResolvedValue({ data: { type: "auths" } });

      // Act
      await service.createToken({ user: userWithoutCompany as User });

      // Assert
      expect(clsService.set).not.toHaveBeenCalled();
    });
  });

  describe("createCode", () => {
    it("should create auth code with expiration", async () => {
      // Arrange
      authRepository.createCode.mockResolvedValue(undefined);
      authRepository.findByCode.mockResolvedValue(MOCK_AUTH_CODE);

      // Act
      const result = await service.createCode({
        authCodeId: "code-123",
        authId: TEST_IDS.authId,
      });

      // Assert
      expect(authRepository.createCode).toHaveBeenCalledWith(
        expect.objectContaining({
          authCodeId: "code-123",
          authId: TEST_IDS.authId,
        }),
      );
      expect(result).toEqual(MOCK_AUTH_CODE);
    });
  });

  describe("refreshToken", () => {
    it("should refresh token successfully", async () => {
      // Arrange
      authRepository.findByRefreshToken.mockResolvedValue(MOCK_AUTH);
      authRepository.findUserById.mockResolvedValue(MOCK_USER);
      authRepository.refreshToken.mockResolvedValue(MOCK_AUTH);
      authRepository.deleteExpiredAuths.mockResolvedValue(undefined);
      jsonApiService.buildSingle.mockResolvedValue({ data: { type: "auths" } });

      // Act
      const result = await service.refreshToken({ refreshToken: TEST_IDS.authId });

      // Assert
      expect(authRepository.findByRefreshToken).toHaveBeenCalledWith({ authId: TEST_IDS.authId });
      expect(authRepository.findUserById).toHaveBeenCalledWith({ userId: MOCK_USER.id });
      expect(authRepository.refreshToken).toHaveBeenCalled();
      expect(authRepository.deleteExpiredAuths).toHaveBeenCalledWith({ userId: MOCK_USER.id });
      expect(result).toEqual({ data: { type: "auths" } });
    });

    it("should throw UNAUTHORIZED when refresh token not found", async () => {
      // Arrange
      authRepository.findByRefreshToken.mockResolvedValue(null);

      // Act & Assert
      await expect(service.refreshToken({ refreshToken: "invalid" })).rejects.toThrow(
        new HttpException("Invalid refresh token", HttpStatus.UNAUTHORIZED),
      );
    });

    it("should throw error when user not found", async () => {
      // Arrange
      authRepository.findByRefreshToken.mockResolvedValue(MOCK_AUTH);
      authRepository.findUserById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.refreshToken({ refreshToken: TEST_IDS.authId })).rejects.toThrow("User not found");
    });
  });

  describe("login", () => {
    const loginData = {
      attributes: {
        email: "test@example.com",
        password: "password123",
      },
    };

    it("should login with valid credentials", async () => {
      // Arrange
      userRepository.findByEmail.mockResolvedValue(MOCK_USER);
      vi.mocked(checkPassword).mockResolvedValue(true);
      authRepository.create.mockResolvedValue(MOCK_AUTH);
      authRepository.setLastLogin.mockResolvedValue(undefined);
      jsonApiService.buildSingle.mockResolvedValue({ data: { type: "auths" } });

      // Act
      const result = await service.login({ data: loginData as any });

      // Assert
      expect(userRepository.findByEmail).toHaveBeenCalledWith({ email: loginData.attributes.email });
      expect(checkPassword).toHaveBeenCalledWith(loginData.attributes.password, MOCK_USER.password);
      expect(authRepository.setLastLogin).toHaveBeenCalledWith({ userId: MOCK_USER.id });
      expect(result).toEqual({ data: { type: "auths" } });
    });

    it("should throw UNAUTHORIZED when user not found", async () => {
      // Arrange
      userRepository.findByEmail.mockResolvedValue(null);

      // Act & Assert
      await expect(service.login({ data: loginData as any })).rejects.toThrow(
        new HttpException("The email or password you entered is incorrect.", HttpStatus.UNAUTHORIZED),
      );
    });

    it("should throw FORBIDDEN when user is deleted", async () => {
      // Arrange
      const deletedUser = { ...MOCK_USER, isDeleted: true };
      userRepository.findByEmail.mockResolvedValue(deletedUser as User);

      // Act & Assert
      await expect(service.login({ data: loginData as any })).rejects.toThrow(
        new HttpException("The account has been deleted", HttpStatus.FORBIDDEN),
      );
    });

    it("should throw FORBIDDEN when user is not active", async () => {
      // Arrange
      const inactiveUser = { ...MOCK_USER, isActive: false };
      userRepository.findByEmail.mockResolvedValue(inactiveUser as User);

      // Act & Assert
      await expect(service.login({ data: loginData as any })).rejects.toThrow(
        new HttpException("The account has not been activated yet", HttpStatus.FORBIDDEN),
      );
    });

    it("should throw UNAUTHORIZED when password is incorrect", async () => {
      // Arrange
      userRepository.findByEmail.mockResolvedValue(MOCK_USER);
      vi.mocked(checkPassword).mockResolvedValue(false);

      // Act & Assert
      await expect(service.login({ data: loginData as any })).rejects.toThrow(
        new HttpException("The email or password you entered is incorrect.", HttpStatus.UNAUTHORIZED),
      );
    });
  });

  describe("register", () => {
    const registerData = {
      id: "new-user-id",
      attributes: {
        email: "new@example.com",
        password: "newpassword123",
        name: "New User",
        companyName: "New Company",
        termsAcceptedAt: "2024-01-01T00:00:00Z",
        marketingConsent: true,
        marketingConsentAt: "2024-01-01T00:00:00Z",
      },
    };

    it("should register new user successfully", async () => {
      // Arrange
      userService.expectNotExists.mockResolvedValue(undefined);
      companyRepository.createByName.mockResolvedValue({ id: TEST_IDS.companyId, name: "New Company" });
      userRepository.create.mockResolvedValue({
        ...MOCK_USER,
        email: registerData.attributes.email,
        company: { id: TEST_IDS.companyId, name: "New Company" },
      } as User);
      emailService.sendEmail.mockResolvedValue(undefined);

      // Act
      await service.register({ data: registerData as any });

      // Assert
      expect(userService.expectNotExists).toHaveBeenCalledWith({ email: registerData.attributes.email });
      expect(companyRepository.createByName).toHaveBeenCalledWith({ name: registerData.attributes.companyName });
      expect(hashPassword).toHaveBeenCalledWith(registerData.attributes.password);
      expect(userRepository.create).toHaveBeenCalled();
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        "activationEmail",
        expect.objectContaining({
          to: registerData.attributes.email,
        }),
        "en",
      );
    });

    it("should throw FORBIDDEN when registration is disabled", async () => {
      // Arrange
      configService.get.mockImplementation((key: string) => {
        if (key === "auth") return { allowRegistration: false };
        if (key === "app") return MOCK_APP_CONFIG;
        return undefined;
      });

      // Act & Assert
      await expect(service.register({ data: registerData as any })).rejects.toThrow(
        new HttpException("Registration is currently disabled", HttpStatus.FORBIDDEN),
      );
    });

    it("should use name as company name when companyName not provided", async () => {
      // Arrange
      const dataWithoutCompanyName = {
        ...registerData,
        attributes: { ...registerData.attributes, companyName: undefined },
      };
      userService.expectNotExists.mockResolvedValue(undefined);
      companyRepository.createByName.mockResolvedValue({ id: TEST_IDS.companyId, name: "New User" });
      userRepository.create.mockResolvedValue(MOCK_USER);
      emailService.sendEmail.mockResolvedValue(undefined);

      // Act
      await service.register({ data: dataWithoutCompanyName as any });

      // Assert
      expect(companyRepository.createByName).toHaveBeenCalledWith({ name: dataWithoutCompanyName.attributes.name });
    });
  });

  describe("findAuthByCode", () => {
    it("should find auth by code successfully", async () => {
      // Arrange
      authRepository.findByCode.mockResolvedValue(MOCK_AUTH_CODE);
      authRepository.findById.mockResolvedValue(MOCK_AUTH);
      jsonApiService.buildSingle.mockResolvedValue({ data: { type: "auths" } });

      // Act
      const result = await service.findAuthByCode({ code: "valid-code" });

      // Assert
      expect(authRepository.findByCode).toHaveBeenCalledWith({ code: "valid-code" });
      expect(authRepository.findById).toHaveBeenCalledWith({ authId: MOCK_AUTH.id });
      expect(result).toEqual({ data: { type: "auths" } });
    });

    it("should throw NOT_FOUND when code is invalid", async () => {
      // Arrange
      authRepository.findByCode.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findAuthByCode({ code: "invalid" })).rejects.toThrow(
        new HttpException("Invalid code", HttpStatus.NOT_FOUND),
      );
    });

    it("should throw NOT_FOUND when code is expired", async () => {
      // Arrange
      const expiredCode = { ...MOCK_AUTH_CODE, expiration: new Date(Date.now() - 1000) };
      authRepository.findByCode.mockResolvedValue(expiredCode as AuthCode);

      // Act & Assert
      await expect(service.findAuthByCode({ code: "expired" })).rejects.toThrow(
        new HttpException("Code has expired", HttpStatus.NOT_FOUND),
      );
    });

    it("should throw NOT_FOUND when auth not found", async () => {
      // Arrange
      authRepository.findByCode.mockResolvedValue(MOCK_AUTH_CODE);
      authRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findAuthByCode({ code: "valid-code" })).rejects.toThrow(
        new HttpException("Auth not found", HttpStatus.NOT_FOUND),
      );
    });
  });

  describe("deleteByToken", () => {
    it("should delete auth by token", async () => {
      // Arrange
      authRepository.deleteByToken.mockResolvedValue(undefined);

      // Act
      await service.deleteByToken({ token: "jwt-token" });

      // Assert
      expect(authRepository.deleteByToken).toHaveBeenCalledWith({ token: "jwt-token" });
    });
  });

  describe("startResetPassword", () => {
    it("should start password reset flow", async () => {
      // Arrange
      userRepository.findByEmail.mockResolvedValue(MOCK_USER);
      authRepository.startResetPassword.mockResolvedValue(MOCK_USER);
      emailService.sendEmail.mockResolvedValue(undefined);

      // Act
      await service.startResetPassword("test@example.com", "en");

      // Assert
      expect(userRepository.findByEmail).toHaveBeenCalledWith({ email: "test@example.com" });
      expect(clsService.set).toHaveBeenCalledWith("companyId", TEST_IDS.companyId);
      expect(authRepository.startResetPassword).toHaveBeenCalledWith({ userId: MOCK_USER.id });
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        "resetEmail",
        expect.objectContaining({
          to: MOCK_USER.email,
        }),
        "en",
      );
    });

    it("should silently return when user not found", async () => {
      // Arrange
      userRepository.findByEmail.mockResolvedValue(null);

      // Act
      await service.startResetPassword("nonexistent@example.com");

      // Assert
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it("should use default language when not provided", async () => {
      // Arrange
      userRepository.findByEmail.mockResolvedValue(MOCK_USER);
      authRepository.startResetPassword.mockResolvedValue(MOCK_USER);
      emailService.sendEmail.mockResolvedValue(undefined);

      // Act
      await service.startResetPassword("test@example.com");

      // Assert
      expect(emailService.sendEmail).toHaveBeenCalledWith("resetEmail", expect.anything(), "en");
    });
  });

  describe("validateCode", () => {
    it("should validate code successfully", async () => {
      // Arrange
      userRepository.findByCode.mockResolvedValue(MOCK_USER);

      // Act & Assert
      await expect(service.validateCode("valid-code")).resolves.toBeUndefined();
    });

    it("should throw NOT_FOUND when code is invalid", async () => {
      // Arrange
      userRepository.findByCode.mockResolvedValue(null);

      // Act & Assert
      await expect(service.validateCode("invalid-code")).rejects.toThrow(
        new HttpException("The code provided is invalid", HttpStatus.NOT_FOUND),
      );
    });

    it("should throw BAD_REQUEST when code is expired", async () => {
      // Arrange
      const expiredUser = { ...MOCK_USER, codeExpiration: new Date(Date.now() - 1000) };
      userRepository.findByCode.mockResolvedValue(expiredUser as User);

      // Act & Assert
      await expect(service.validateCode("expired-code")).rejects.toThrow(
        new HttpException("The code is expired", HttpStatus.BAD_REQUEST),
      );
    });
  });

  describe("resetPassword", () => {
    it("should reset password successfully", async () => {
      // Arrange
      userRepository.findByCode.mockResolvedValue(MOCK_USER);
      authRepository.resetPassword.mockResolvedValue(undefined);

      // Act
      await service.resetPassword("valid-code", "newpassword123");

      // Assert
      expect(hashPassword).toHaveBeenCalledWith("newpassword123");
      expect(authRepository.resetPassword).toHaveBeenCalledWith({
        userId: MOCK_USER.id,
        password: "hashed-password",
      });
    });

    it("should throw NOT_FOUND when code is invalid", async () => {
      // Arrange
      userRepository.findByCode.mockResolvedValue(null);

      // Act & Assert
      await expect(service.resetPassword("invalid-code", "newpassword")).rejects.toThrow(
        new HttpException("The code provided is invalid", HttpStatus.NOT_FOUND),
      );
    });

    it("should throw BAD_REQUEST when code is expired", async () => {
      // Arrange
      const expiredUser = { ...MOCK_USER, codeExpiration: new Date(Date.now() - 1000) };
      userRepository.findByCode.mockResolvedValue(expiredUser as User);

      // Act & Assert
      await expect(service.resetPassword("expired-code", "newpassword")).rejects.toThrow(
        new HttpException("The code is expired", HttpStatus.BAD_REQUEST),
      );
    });
  });

  describe("acceptInvitation", () => {
    it("should accept invitation and set password", async () => {
      // Arrange
      userRepository.findByCode.mockResolvedValue(MOCK_USER);
      authRepository.acceptInvitation.mockResolvedValue(undefined);

      // Act
      await service.acceptInvitation("valid-code", "newpassword123");

      // Assert
      expect(hashPassword).toHaveBeenCalledWith("newpassword123");
      expect(authRepository.acceptInvitation).toHaveBeenCalledWith({
        userId: MOCK_USER.id,
        password: "hashed-password",
      });
    });

    it("should throw NOT_FOUND when code is invalid", async () => {
      // Arrange
      userRepository.findByCode.mockResolvedValue(null);

      // Act & Assert
      await expect(service.acceptInvitation("invalid-code", "newpassword")).rejects.toThrow(
        new HttpException("The code provided is invalid", HttpStatus.NOT_FOUND),
      );
    });

    it("should throw BAD_REQUEST when code is expired", async () => {
      // Arrange
      const expiredUser = { ...MOCK_USER, codeExpiration: new Date(Date.now() - 1000) };
      userRepository.findByCode.mockResolvedValue(expiredUser as User);

      // Act & Assert
      await expect(service.acceptInvitation("expired-code", "newpassword")).rejects.toThrow(
        new HttpException("The code is expired", HttpStatus.BAD_REQUEST),
      );
    });
  });

  describe("activateAccount", () => {
    it("should activate account successfully", async () => {
      // Arrange
      userRepository.findByCode.mockResolvedValue(MOCK_USER);
      authRepository.activateAccount.mockResolvedValue(undefined);
      trialQueueService.queueTrialCreation.mockResolvedValue(undefined);

      // Act
      await service.activateAccount("valid-code");

      // Assert
      expect(authRepository.activateAccount).toHaveBeenCalledWith({ userId: MOCK_USER.id });
      expect(trialQueueService.queueTrialCreation).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        userId: MOCK_USER.id,
      });
    });

    it("should throw NOT_FOUND when code is invalid", async () => {
      // Arrange
      userRepository.findByCode.mockResolvedValue(null);

      // Act & Assert
      await expect(service.activateAccount("invalid-code")).rejects.toThrow(
        new HttpException("The code provided is invalid", HttpStatus.NOT_FOUND),
      );
    });

    it("should throw NOT_FOUND when code is expired", async () => {
      // Arrange
      const expiredUser = { ...MOCK_USER, codeExpiration: new Date(Date.now() - 1000) };
      userRepository.findByCode.mockResolvedValue(expiredUser as User);

      // Act & Assert
      await expect(service.activateAccount("expired-code")).rejects.toThrow(
        new HttpException("The code provided is expired", HttpStatus.NOT_FOUND),
      );
    });

    it("should not queue trial when user has no company", async () => {
      // Arrange
      const userWithoutCompany = { ...MOCK_USER, company: undefined };
      userRepository.findByCode.mockResolvedValue(userWithoutCompany as User);
      authRepository.activateAccount.mockResolvedValue(undefined);

      // Act
      await service.activateAccount("valid-code");

      // Assert
      expect(trialQueueService.queueTrialCreation).not.toHaveBeenCalled();
    });
  });

  describe("completeOAuthRegistration", () => {
    const oauthParams = {
      pendingId: "pending-123",
      termsAcceptedAt: "2024-01-01T00:00:00Z",
      marketingConsent: true,
      marketingConsentAt: "2024-01-01T00:00:00Z",
    };

    const mockPendingDiscord = {
      provider: "discord",
      providerUserId: "discord-123",
      email: "discord@example.com",
      name: "Discord User",
      avatar: "https://cdn.discordapp.com/avatar.png",
    };

    const mockPendingGoogle = {
      provider: "google",
      providerUserId: "google-123",
      email: "google@example.com",
      name: "Google User",
      avatar: "https://lh3.googleusercontent.com/photo.jpg",
    };

    it("should complete OAuth registration for Discord user", async () => {
      // Arrange
      pendingRegistrationService.get.mockResolvedValue(mockPendingDiscord);
      discordUserService.create.mockResolvedValue(undefined);
      trialQueueService.queueTrialCreation.mockResolvedValue(undefined);
      pendingRegistrationService.delete.mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      authRepository.create.mockResolvedValue(MOCK_AUTH);
      authRepository.setLastLogin.mockResolvedValue(undefined);
      authRepository.createCode.mockResolvedValue(undefined);
      authRepository.findByCode.mockResolvedValue(MOCK_AUTH_CODE);
      jsonApiService.buildSingle.mockResolvedValue({
        data: { attributes: { refreshToken: TEST_IDS.authId } },
      });

      // Act
      const result = await service.completeOAuthRegistration(oauthParams);

      // Assert
      expect(pendingRegistrationService.get).toHaveBeenCalledWith(oauthParams.pendingId);
      expect(discordUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userDetails: {
            id: mockPendingDiscord.providerUserId,
            email: mockPendingDiscord.email,
            username: mockPendingDiscord.name,
            avatar: mockPendingDiscord.avatar,
          },
        }),
      );
      expect(trialQueueService.queueTrialCreation).toHaveBeenCalled();
      expect(pendingRegistrationService.delete).toHaveBeenCalledWith(oauthParams.pendingId);
      expect(result).toHaveProperty("code");
    });

    it("should complete OAuth registration for Google user", async () => {
      // Arrange
      pendingRegistrationService.get.mockResolvedValue(mockPendingGoogle);
      googleUserService.create.mockResolvedValue(undefined);
      trialQueueService.queueTrialCreation.mockResolvedValue(undefined);
      pendingRegistrationService.delete.mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      authRepository.create.mockResolvedValue(MOCK_AUTH);
      authRepository.setLastLogin.mockResolvedValue(undefined);
      authRepository.createCode.mockResolvedValue(undefined);
      authRepository.findByCode.mockResolvedValue(MOCK_AUTH_CODE);
      jsonApiService.buildSingle.mockResolvedValue({
        data: { attributes: { refreshToken: TEST_IDS.authId } },
      });

      // Act
      const result = await service.completeOAuthRegistration(oauthParams);

      // Assert
      expect(googleUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userDetails: {
            id: mockPendingGoogle.providerUserId,
            email: mockPendingGoogle.email,
            name: mockPendingGoogle.name,
            picture: mockPendingGoogle.avatar,
          },
        }),
      );
      expect(result).toHaveProperty("code");
    });

    it("should throw NOT_FOUND when pending registration not found", async () => {
      // Arrange
      pendingRegistrationService.get.mockResolvedValue(null);

      // Act & Assert
      await expect(service.completeOAuthRegistration(oauthParams)).rejects.toThrow(
        new HttpException("Pending registration not found or expired", HttpStatus.NOT_FOUND),
      );
    });

    it("should throw FORBIDDEN when registration is disabled", async () => {
      // Arrange
      pendingRegistrationService.get.mockResolvedValue(mockPendingDiscord);
      configService.get.mockImplementation((key: string) => {
        if (key === "auth") return { allowRegistration: false };
        if (key === "app") return MOCK_APP_CONFIG;
        return undefined;
      });

      // Act & Assert
      await expect(service.completeOAuthRegistration(oauthParams)).rejects.toThrow(
        new HttpException("Registration is currently disabled", HttpStatus.FORBIDDEN),
      );
    });

    it("should throw BAD_REQUEST for unsupported provider", async () => {
      // Arrange
      const unsupportedProvider = { ...mockPendingDiscord, provider: "facebook" };
      pendingRegistrationService.get.mockResolvedValue(unsupportedProvider);

      // Act & Assert
      await expect(service.completeOAuthRegistration(oauthParams)).rejects.toThrow(
        new HttpException("Unsupported provider: facebook", HttpStatus.BAD_REQUEST),
      );
    });
  });
});
