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
import { TwoFactorService } from "../../../two-factor/services/two-factor.service";
import { Auth, AuthDescriptor } from "../../entities/auth";
import { AuthCode } from "../../entities/auth.code";
import { PendingAuthDescriptor } from "../../entities/pending-auth";
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
    buildList: vi.fn(),
  });

  const createMockAuthRepository = () => ({
    countUserCompanies: vi.fn().mockResolvedValue(1),
    findUserCompanies: vi.fn(),
    createSession: vi.fn(),
    findByToken: vi.fn(),
    findByRefreshToken: vi.fn(),
    findAuthById: vi.fn(),
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
    createUser: vi.fn(),
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
    signCompanySelectionJwt: vi.fn().mockReturnValue("selection-token"),
    signPendingJwt: vi.fn().mockReturnValue("pending-jwt-token"),
    decodeJwt: vi.fn().mockReturnValue({ userId: TEST_IDS.userId, companyId: TEST_IDS.companyId }),
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

  const createMockTwoFactorService = () => ({
    getConfig: vi.fn().mockResolvedValue(null),
    createPendingSession: vi.fn(),
    getAvailableMethods: vi.fn().mockResolvedValue([]),
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
        { provide: TwoFactorService, useValue: createMockTwoFactorService() },
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
      authRepository.createSession.mockResolvedValue(MOCK_AUTH);
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
      expect(authRepository.createSession).toHaveBeenCalled();
      expect(authRepository.setLastLogin).toHaveBeenCalledWith({ userId: MOCK_USER.id });
      expect((result as any).refreshToken).toBe(MOCK_AUTH.id);
    });

    it("should clear user when refreshToken is provided", async () => {
      // Arrange
      const authWithUser = { ...MOCK_AUTH };
      authRepository.createSession.mockResolvedValue(authWithUser);
      authRepository.setLastLogin.mockResolvedValue(undefined);

      // Act
      const result = await service.createAuth({ user: MOCK_USER, refreshToken: "existing-refresh-token" });

      // Assert
      expect(result.user).toBeUndefined();
    });

    it("should handle user without roles", async () => {
      // Arrange
      const userWithoutRoles = { ...MOCK_USER, role: undefined };
      authRepository.createSession.mockResolvedValue(MOCK_AUTH);
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
      authRepository.createSession.mockResolvedValue(MOCK_AUTH);
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
      authRepository.createSession.mockResolvedValue(MOCK_AUTH);
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
      authRepository.createSession.mockResolvedValue(authWithoutCompany);
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
      expect(securityService.decodeJwt).toHaveBeenCalledWith(MOCK_AUTH.token);
      expect(authRepository.findUserById).toHaveBeenCalledWith({
        userId: MOCK_USER.id,
        companyId: TEST_IDS.companyId,
      });
      expect(authRepository.refreshToken).toHaveBeenCalled();
      expect(authRepository.deleteExpiredAuths).toHaveBeenCalledWith({ userId: MOCK_USER.id });
      expect(result).toEqual({ data: { type: "auths" } });
    });

    it("should re-derive roles without a company when the expiring token carried none", async () => {
      // Arrange
      (securityService.decodeJwt as any).mockReturnValue({ userId: MOCK_USER.id });
      authRepository.findByRefreshToken.mockResolvedValue(MOCK_AUTH);
      authRepository.findUserById.mockResolvedValue(MOCK_USER);
      authRepository.refreshToken.mockResolvedValue(MOCK_AUTH);
      authRepository.deleteExpiredAuths.mockResolvedValue(undefined);
      jsonApiService.buildSingle.mockResolvedValue({ data: { type: "auths" } });

      // Act
      await service.refreshToken({ refreshToken: TEST_IDS.authId });

      // Assert
      expect(authRepository.findUserById).toHaveBeenCalledWith({
        userId: MOCK_USER.id,
        companyId: undefined,
      });
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
      authRepository.createSession.mockResolvedValue(MOCK_AUTH);
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

    it("should ask for a company selection, and create no session, when the user has more than one company", async () => {
      // Arrange
      userRepository.findByEmail.mockResolvedValue(MOCK_USER);
      vi.mocked(checkPassword).mockResolvedValue(true);
      authRepository.countUserCompanies.mockResolvedValue(2);
      const mockResponse = { data: { attributes: { requiresCompanySelection: true } } };
      jsonApiService.buildSingle.mockResolvedValue(mockResponse);

      // Act
      const result = await service.login({ data: loginData as any });

      // Assert
      expect(securityService.signCompanySelectionJwt).toHaveBeenCalledWith({ userId: MOCK_USER.id });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ requiresCompanySelection: true, selectionToken: "selection-token" }),
      );
      expect(authRepository.createSession).not.toHaveBeenCalled();
      expect(authRepository.setLastLogin).not.toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });
  });

  describe("findCompanies", () => {
    it("should list the companies of the user in the token", async () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.userId);
      const companies = [{ id: TEST_IDS.companyId }] as any;
      authRepository.findUserCompanies.mockResolvedValue(companies);
      const mockResponse = { data: companies };
      jsonApiService.buildList.mockResolvedValue(mockResponse);

      // Act
      const result = await service.findCompanies();

      // Assert
      expect(authRepository.findUserCompanies).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(jsonApiService.buildList).toHaveBeenCalledWith(expect.anything(), companies, expect.anything());
      expect(result).toEqual(mockResponse);
    });
  });

  describe("selectCompany", () => {
    it("should mint a company-scoped session for a company the user belongs to", async () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.userId);
      authRepository.findUserById.mockResolvedValue(MOCK_USER);
      authRepository.createSession.mockResolvedValue(MOCK_AUTH);
      const mockResponse = { data: { type: "auths" } };
      jsonApiService.buildSingle.mockResolvedValue(mockResponse);

      // Act
      const result = await service.selectCompany({ companyId: TEST_IDS.companyId });

      // Assert
      expect(authRepository.findUserById).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
      });
      expect(authRepository.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ userId: TEST_IDS.userId, companyId: TEST_IDS.companyId }),
      );
      expect(result).toEqual(mockResponse);
    });

    it("should throw 403 when the user does not belong to the company", async () => {
      // Arrange
      clsService.get.mockReturnValue(TEST_IDS.userId);
      authRepository.findUserById.mockResolvedValue({ ...MOCK_USER, company: undefined } as User);

      // Act & Assert
      await expect(service.selectCompany({ companyId: "another-company" })).rejects.toThrow(
        new HttpException("User does not belong to this company", HttpStatus.FORBIDDEN),
      );
      expect(authRepository.createSession).not.toHaveBeenCalled();
    });
  });

  describe("findAuthByCode", () => {
    it("should find auth by code successfully", async () => {
      // Arrange
      authRepository.findByCode.mockResolvedValue(MOCK_AUTH_CODE);
      authRepository.findAuthById.mockResolvedValue(MOCK_AUTH);
      jsonApiService.buildSingle.mockResolvedValue({ data: { type: "auths" } });

      // Act
      const result = await service.findAuthByCode({ code: "valid-code" });

      // Assert
      expect(authRepository.findByCode).toHaveBeenCalledWith({ code: "valid-code" });
      expect(authRepository.findAuthById).toHaveBeenCalledWith({ authId: MOCK_AUTH.id });
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
      authRepository.findAuthById.mockResolvedValue(null);

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
      authRepository.createSession.mockResolvedValue(MOCK_AUTH);
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
      authRepository.createSession.mockResolvedValue(MOCK_AUTH);
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

  /**
   * The satellite foundation modules (TwoFactorModule, WaitlistModule,
   * DiscordUserModule, the trial queue) are @Optional() on AuthService so an
   * application can compose auth without them. These tests build the service
   * with a dependency deliberately absent — the package AuthModule still
   * provides all of them, so the default behaviour is unchanged.
   */
  describe("optional satellite dependencies", () => {
    const LOGIN_DATA = {
      attributes: {
        email: "test@example.com",
        password: "password123",
      },
    };

    const REGISTER_DATA = {
      id: "new-user-id",
      attributes: {
        email: "new@example.com",
        password: "newpassword123",
        name: "New User",
        inviteCode: "invite-123",
      },
    };

    /**
     * Builds AuthService with every dependency EXCEPT TwoFactorService (which
     * has to be opted in explicitly, since its absence is what most of these
     * tests exercise). `omit` drops a token entirely; `overrides` replaces one.
     */
    const buildModule = async (params?: { omit?: any[]; overrides?: any[] }): Promise<TestingModule> => {
      const base: any[] = [
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
      ];

      const omit = params?.omit ?? [];
      const overrides = params?.overrides ?? [];
      const overridden = overrides.map((provider) => provider.provide);

      return Test.createTestingModule({
        providers: [
          AuthService,
          ...base.filter((provider) => !omit.includes(provider.provide) && !overridden.includes(provider.provide)),
          ...overrides,
        ],
      }).compile();
    };

    it("logs in with a full auth payload when TwoFactorService is absent", async () => {
      // Arrange
      const module = await buildModule();
      const scopedService = module.get<AuthService>(AuthService);
      const scopedUsers = module.get(UserRepository) as any;
      const scopedRepository = module.get(AuthRepository) as any;
      const scopedJsonApi = module.get(JsonApiService) as any;

      scopedUsers.findByEmail.mockResolvedValue(MOCK_USER);
      vi.mocked(checkPassword).mockResolvedValue(true);
      scopedRepository.countUserCompanies.mockResolvedValue(1);
      scopedRepository.createSession.mockResolvedValue(MOCK_AUTH);
      scopedJsonApi.buildSingle.mockResolvedValue({ data: { type: "auth" } });

      // Act
      const result = await scopedService.login({ data: LOGIN_DATA as any });

      // Assert
      expect(scopedRepository.createSession).toHaveBeenCalled();
      expect(scopedJsonApi.buildSingle).toHaveBeenCalledWith(AuthDescriptor.model, expect.anything());
      expect(scopedJsonApi.buildSingle).not.toHaveBeenCalledWith(PendingAuthDescriptor.model, expect.anything());
      expect(result).toEqual({ data: { type: "auth" } });
    });

    it("still returns the two-factor challenge when TwoFactorService is present and enabled", async () => {
      // Arrange
      const twoFactorService = createMockTwoFactorService();
      twoFactorService.getConfig.mockResolvedValue({ isEnabled: true, preferredMethod: "totp" });
      twoFactorService.createPendingSession.mockResolvedValue({
        pendingId: "pending-123",
        expiration: new Date(Date.now() + 300000),
      });
      twoFactorService.getAvailableMethods.mockResolvedValue(["totp"]);

      const module = await buildModule({ overrides: [{ provide: TwoFactorService, useValue: twoFactorService }] });
      const scopedService = module.get<AuthService>(AuthService);
      const scopedUsers = module.get(UserRepository) as any;
      const scopedRepository = module.get(AuthRepository) as any;
      const scopedJsonApi = module.get(JsonApiService) as any;

      scopedUsers.findByEmail.mockResolvedValue(MOCK_USER);
      vi.mocked(checkPassword).mockResolvedValue(true);
      scopedJsonApi.buildSingle.mockResolvedValue({ data: { type: "two-factor-challenge" } });

      // Act
      const result = await scopedService.login({ data: LOGIN_DATA as any });

      // Assert
      expect(scopedJsonApi.buildSingle).toHaveBeenCalledWith(
        PendingAuthDescriptor.model,
        expect.objectContaining({
          id: "pending-123",
          pendingToken: "pending-jwt-token",
          preferredMethod: "totp",
          availableMethods: ["totp"],
        }),
      );
      expect(scopedRepository.createSession).not.toHaveBeenCalled();
      expect(result).toEqual({ data: { type: "two-factor-challenge" } });
    });

    it("throws NOT_IMPLEMENTED on waitlist registration when WaitlistService is absent", async () => {
      // Arrange
      const configService = {
        get: vi.fn((key: string) => {
          if (key === "auth") return { allowRegistration: true, registrationMode: "waitlist" };
          if (key === "app") return MOCK_APP_CONFIG;
          return undefined;
        }),
      };

      const module = await buildModule({
        omit: [WaitlistService],
        overrides: [{ provide: ConfigService, useValue: configService }],
      });
      const scopedService = module.get<AuthService>(AuthService);

      // Act & Assert
      await expect(scopedService.register({ data: REGISTER_DATA as any })).rejects.toThrow(
        new HttpException("Waitlist registration is not available", HttpStatus.NOT_IMPLEMENTED),
      );
    });

    it("registers normally in waitlist mode when WaitlistService is present", async () => {
      // Arrange
      const configService = {
        get: vi.fn((key: string) => {
          if (key === "auth") return { allowRegistration: true, registrationMode: "waitlist" };
          if (key === "app") return MOCK_APP_CONFIG;
          return undefined;
        }),
      };

      const module = await buildModule({ overrides: [{ provide: ConfigService, useValue: configService }] });
      const scopedService = module.get<AuthService>(AuthService);
      const scopedWaitlist = module.get(WaitlistService) as any;
      const scopedUserService = module.get(UserService) as any;
      const scopedUsers = module.get(UserRepository) as any;
      const scopedCompanies = module.get(CompanyRepository) as any;

      scopedWaitlist.validateInviteCode.mockResolvedValue({ valid: true });
      scopedUserService.expectNotExists.mockResolvedValue(undefined);
      scopedCompanies.createByName.mockResolvedValue({ id: TEST_IDS.companyId, name: "New Company" });
      scopedUsers.createUser.mockResolvedValue(MOCK_USER);

      // Act
      await scopedService.register({ data: REGISTER_DATA as any });

      // Assert
      expect(scopedWaitlist.validateInviteCode).toHaveBeenCalledWith(REGISTER_DATA.attributes.inviteCode);
      expect(scopedWaitlist.markAsRegistered).toHaveBeenCalled();
    });

    it("activates an account without queueing a trial when TrialQueueService is absent", async () => {
      // Arrange
      const module = await buildModule({ omit: [TrialQueueService] });
      const scopedService = module.get<AuthService>(AuthService);
      const scopedUsers = module.get(UserRepository) as any;
      const scopedRepository = module.get(AuthRepository) as any;

      scopedUsers.findByCode.mockResolvedValue(MOCK_USER);
      scopedUsers.findPlatformAdministrators = vi.fn().mockResolvedValue([]);

      // Act
      await scopedService.activateAccount("valid-code");

      // Assert
      expect(scopedRepository.activateAccount).toHaveBeenCalledWith({ userId: MOCK_USER.id });
    });
  });
});

/**
 * Wire-contract parity: the descriptors replaced the hand-written
 * AuthSerialiser / PendingAuthSerialiser, and the attribute sets they
 * serialise must stay identical. The one sanctioned change is the Auth
 * self-link endpoint, `auth/refreshtoken` -> `auth`.
 */
describe("Auth descriptors — serialiser parity", () => {
  it("pins the Auth attribute set (fields + virtual fields)", () => {
    const attributes = [...Object.keys(AuthDescriptor.fields), ...Object.keys(AuthDescriptor.virtualFields)].sort();

    expect(attributes).toEqual(["expiration", "refreshToken", "requiresCompanySelection", "selectionToken", "token"]);
  });

  it("pins the Auth relationship set", () => {
    expect(Object.keys(AuthDescriptor.relationships)).toEqual(["user"]);
  });

  it("pins the PendingAuth attribute set to the deleted PendingAuthSerialiser", () => {
    expect(Object.keys(PendingAuthDescriptor.fields).sort()).toEqual([
      "availableMethods",
      "expiresAt",
      "pendingToken",
      "preferredMethod",
    ]);
    expect(Object.keys(PendingAuthDescriptor.virtualFields)).toEqual([]);
    expect(Object.keys(PendingAuthDescriptor.relationships)).toEqual([]);
  });

  it("serves the Auth resource from the `auth` endpoint (self-link fix)", () => {
    expect(AuthDescriptor.model.endpoint).toBe("auth");
    expect(AuthDescriptor.model.type).toBe("auth");
  });

  it("keeps the two-factor challenge JSON:API type", () => {
    expect(PendingAuthDescriptor.model.type).toBe("two-factor-challenge");
  });
});
