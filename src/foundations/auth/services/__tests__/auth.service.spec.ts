import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { EventEmitter2 } from "@nestjs/event-emitter";
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
import { PendingRegistration, PendingRegistrationService } from "../pending-registration.service";
import { DiscordUserService } from "../../../discord-user/services/discord-user.service";
import { GoogleUserService } from "../../../google-user/services/google-user.service";
import { TrialQueueService } from "../trial-queue.service";
import { WaitlistService } from "../../../waitlist/services/waitlist.service";
import { TwoFactorService } from "../../../two-factor/services/two-factor.service";
import { ResponseLanguageService } from "../../../user/services/response-language.service";
import { Auth, AuthDescriptor } from "../../entities/auth";
import { AuthCode } from "../../entities/auth.code";
import { PendingAuthDescriptor } from "../../entities/pending-auth";
import { PendingRegistrationDescriptor } from "../../entities/pending-registration.resource";
import { REGISTRATION_PASS } from "../../interfaces/registration-pass.interface";
import { User } from "../../../user/entities/user";
import { USER_ACTIVATED_EVENT } from "../../events/auth.events";

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
  let eventEmitter: MockedObject<EventEmitter2>;

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
    consumeCode: vi.fn(),
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
    setSignupSource: vi.fn(),
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

  const createMockResponseLanguageService = () => ({
    resolve: vi.fn().mockResolvedValue(undefined),
    resolveForUser: vi.fn().mockResolvedValue(undefined),
    resolveForEmail: vi.fn().mockResolvedValue(undefined),
    normalise: vi.fn(),
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
        { provide: ResponseLanguageService, useValue: createMockResponseLanguageService() },
        { provide: EventEmitter2, useValue: { emit: vi.fn() } },
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
    eventEmitter = module.get(EventEmitter2) as MockedObject<EventEmitter2>;
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

    it("should throw UNAUTHORIZED and mint nothing when the refresh token has expired", async () => {
      // Arrange: the repository filters expired Auths out, so an expired token reads as null
      authRepository.findByRefreshToken.mockResolvedValue(null);

      // Act & Assert
      await expect(service.refreshToken({ refreshToken: TEST_IDS.authId })).rejects.toThrow(
        new HttpException("Invalid refresh token", HttpStatus.UNAUTHORIZED),
      );
      expect(securityService.signJwt).not.toHaveBeenCalled();
      expect(authRepository.refreshToken).not.toHaveBeenCalled();
    });

    it("should throw UNAUTHORIZED when the Auth expires between the read and the extension", async () => {
      // Arrange
      authRepository.findByRefreshToken.mockResolvedValue(MOCK_AUTH);
      authRepository.findUserById.mockResolvedValue(MOCK_USER);
      authRepository.refreshToken.mockResolvedValue(null);

      // Act & Assert
      await expect(service.refreshToken({ refreshToken: TEST_IDS.authId })).rejects.toThrow(
        new HttpException("Invalid refresh token", HttpStatus.UNAUTHORIZED),
      );
      expect(authRepository.deleteExpiredAuths).not.toHaveBeenCalled();
      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
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
    it("uses the code up and returns its auth", async () => {
      authRepository.consumeCode.mockResolvedValue(MOCK_AUTH.id);
      authRepository.findAuthById.mockResolvedValue(MOCK_AUTH);
      jsonApiService.buildSingle.mockResolvedValue({ data: { type: "auths" } });

      const result = await service.findAuthByCode({ code: "valid-code" });

      expect(authRepository.consumeCode).toHaveBeenCalledWith({ code: "valid-code" });
      expect(authRepository.findByCode).not.toHaveBeenCalled();
      expect(authRepository.findAuthById).toHaveBeenCalledWith({ authId: MOCK_AUTH.id });
      expect(result).toEqual({ data: { type: "auths" } });
    });

    it("refuses a code that is unknown, already used or expired", async () => {
      authRepository.consumeCode.mockResolvedValue(null);

      await expect(service.findAuthByCode({ code: "used" })).rejects.toThrow(
        new HttpException("Invalid code", HttpStatus.NOT_FOUND),
      );
      expect(authRepository.findAuthById).not.toHaveBeenCalled();
    });

    it("refuses the losing side of two concurrent exchanges of one code", async () => {
      authRepository.consumeCode.mockRejectedValue(new Error("Transaction failed: node deleted"));

      await expect(service.findAuthByCode({ code: "raced" })).rejects.toThrow(
        new HttpException("Invalid code", HttpStatus.NOT_FOUND),
      );
      expect(authRepository.findAuthById).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when auth not found", async () => {
      // Arrange
      authRepository.consumeCode.mockResolvedValue(MOCK_AUTH.id);
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

  describe("startResetPassword", () => {
    let responseLanguage: ReturnType<typeof createMockResponseLanguageService>;

    beforeEach(() => {
      responseLanguage = (service as any).responseLanguage;
      userRepository.findByEmail.mockResolvedValue(MOCK_USER);
      authRepository.startResetPassword.mockResolvedValue(MOCK_USER);
    });

    it("sends the reset email in the recipient's saved language", async () => {
      responseLanguage.resolveForEmail.mockResolvedValue("it");

      await service.startResetPassword(MOCK_USER.email, "en");

      expect(responseLanguage.resolveForEmail).toHaveBeenCalledWith({ email: MOCK_USER.email });
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        "resetEmail",
        expect.objectContaining({ resetLink: `https://example.com/it/reset/${MOCK_USER.code}` }),
        "it",
      );
    });

    it("falls back to the lng query value when no language resolves", async () => {
      await service.startResetPassword(MOCK_USER.email, "fr");

      expect(emailService.sendEmail).toHaveBeenCalledWith("resetEmail", expect.any(Object), "fr");
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
      expect(eventEmitter.emit).not.toHaveBeenCalled();
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
      expect(eventEmitter.emit).toHaveBeenCalledWith(USER_ACTIVATED_EVENT, { user: MOCK_USER });
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

    it("emits USER_ACTIVATED_EVENT with the language passed to activateAccount", async () => {
      userRepository.findByCode.mockResolvedValue(MOCK_USER);
      authRepository.activateAccount.mockResolvedValue(undefined);
      trialQueueService.queueTrialCreation.mockResolvedValue(undefined);

      await service.activateAccount("code-1", "it");

      expect(eventEmitter.emit).toHaveBeenCalledWith(USER_ACTIVATED_EVENT, {
        user: expect.objectContaining({ id: MOCK_USER.id }),
        language: "it",
      });
    });

    it("emits USER_ACTIVATED_EVENT without a language when none was passed", async () => {
      userRepository.findByCode.mockResolvedValue(MOCK_USER);
      authRepository.activateAccount.mockResolvedValue(undefined);
      trialQueueService.queueTrialCreation.mockResolvedValue(undefined);

      await service.activateAccount("code-1");

      const call = eventEmitter.emit.mock.calls.find(([name]) => name === USER_ACTIVATED_EVENT);
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ user: expect.objectContaining({ id: MOCK_USER.id }) });
      expect((call?.[1] as { language?: string }).language).toBeUndefined();
    });
  });

  describe("completeOAuthRegistration", () => {
    const oauthParams = {
      pendingId: "pending-123",
      termsAcceptedAt: "2024-01-01T00:00:00Z",
      marketingConsent: true,
      marketingConsentAt: "2024-01-01T00:00:00Z",
    };

    const mockPendingDiscord: PendingRegistration = {
      id: "pending-123",
      provider: "discord",
      providerUserId: "discord-123",
      email: "discord@example.com",
      name: "Discord User",
      avatar: "https://cdn.discordapp.com/avatar.png",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockPendingGoogle: PendingRegistration = {
      id: "pending-123",
      provider: "google",
      providerUserId: "google-123",
      email: "google@example.com",
      name: "Google User",
      avatar: "https://lh3.googleusercontent.com/photo.jpg",
      createdAt: "2024-01-01T00:00:00Z",
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
      expect(eventEmitter.emit).toHaveBeenCalledWith(USER_ACTIVATED_EVENT, { user: MOCK_USER });
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

    it("emits USER_ACTIVATED_EVENT with the language passed to completeOAuthRegistration", async () => {
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

      await service.completeOAuthRegistration(oauthParams, "it");

      expect(eventEmitter.emit).toHaveBeenCalledWith(USER_ACTIVATED_EVENT, {
        user: expect.objectContaining({ id: MOCK_USER.id }),
        language: "it",
      });
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
      // Deliberately invalid: "facebook" is outside PendingRegistration["provider"].
      const unsupportedProvider = { ...mockPendingDiscord, provider: "facebook" } as unknown as PendingRegistration;
      pendingRegistrationService.get.mockResolvedValue(unsupportedProvider);

      // Act & Assert
      await expect(service.completeOAuthRegistration(oauthParams)).rejects.toThrow(
        new HttpException("Unsupported provider: facebook", HttpStatus.BAD_REQUEST),
      );
    });
  });

  /**
   * Registration pass (REGISTRATION_PASS hook) and email-in-use rules at completion.
   */
  describe("completeOAuthRegistration — registration pass and email in use", () => {
    const oauthParams = {
      pendingId: "pending-123",
      termsAcceptedAt: "2026-10-25T00:00:00Z",
      marketingConsent: false,
      marketingConsentAt: null,
    };

    const pendingDiscord = (overrides: Record<string, unknown> = {}): PendingRegistration =>
      ({
        id: "pending-123",
        provider: "discord",
        providerUserId: "discord-123",
        email: "player@example.com",
        name: "Player",
        createdAt: "2026-10-25T00:00:00Z",
        ...overrides,
      }) as PendingRegistration;

    const PASS_REFUSED = new HttpException("This registration pass is no longer valid", HttpStatus.FORBIDDEN);

    let hook: { validate: ReturnType<typeof vi.fn>; consume: ReturnType<typeof vi.fn> };
    let findPlatformAdministrators: ReturnType<typeof vi.fn>;

    const useRegistrationMode = (registrationMode: "open" | "waitlist") =>
      configService.get.mockImplementation((key: string) => {
        if (key === "auth") return { allowRegistration: true, registrationMode };
        if (key === "app") return MOCK_APP_CONFIG;
        return undefined;
      });

    const provideHook = () =>
      moduleRef.get.mockImplementation(((token: unknown) => {
        if (token === REGISTRATION_PASS) return hook;
        throw new Error(`no provider for ${String(token)}`);
      }) as any);

    beforeEach(() => {
      hook = { validate: vi.fn().mockResolvedValue("valid"), consume: vi.fn().mockResolvedValue(undefined) };
      findPlatformAdministrators = vi.fn().mockResolvedValue([]);
      (userRepository as any).findPlatformAdministrators = findPlatformAdministrators;
      useRegistrationMode("waitlist");
      provideHook();
      userRepository.findByEmail.mockResolvedValue(null as any);
      discordUserService.create.mockResolvedValue(undefined);
      googleUserService.create.mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      authRepository.createSession.mockResolvedValue(MOCK_AUTH);
      jsonApiService.buildSingle.mockResolvedValue({
        data: { attributes: { refreshToken: TEST_IDS.authId } },
      });
    });

    it("pass sign-up in waitlist mode skips the invite check, queues no trial, emits no user.activated, consumes the pass, still notifies admins", async () => {
      pendingRegistrationService.get.mockResolvedValue(pendingDiscord({ pass: "code-1" }));

      const result = await service.completeOAuthRegistration(oauthParams);

      expect(hook.validate).toHaveBeenCalledWith({
        pass: "code-1",
        provider: "discord",
        providerUserId: "discord-123",
      });
      expect(waitlistService.validateInviteCode).not.toHaveBeenCalled();
      expect(discordUserService.create).toHaveBeenCalled();
      expect(trialQueueService.queueTrialCreation).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(USER_ACTIVATED_EVENT, expect.anything());
      expect(hook.consume).toHaveBeenCalledWith({ pass: "code-1" });
      expect(discordUserService.create.mock.invocationCallOrder[0]).toBeLessThan(
        hook.consume.mock.invocationCallOrder[0],
      );
      expect(findPlatformAdministrators).toHaveBeenCalled();
      expect(result).toEqual({ code: "mock-random-uuid" });
    });

    it("pass that is now invalid is refused with 403 and nothing is created", async () => {
      pendingRegistrationService.get.mockResolvedValue(pendingDiscord({ pass: "code-1" }));
      hook.validate.mockResolvedValue("invalid");

      await expect(service.completeOAuthRegistration(oauthParams)).rejects.toThrow(PASS_REFUSED);

      expect(discordUserService.create).not.toHaveBeenCalled();
      expect(hook.consume).not.toHaveBeenCalled();
    });

    it("pass mismatch at completion is refused with 403", async () => {
      useRegistrationMode("open");
      pendingRegistrationService.get.mockResolvedValue(pendingDiscord({ pass: "code-1" }));
      hook.validate.mockResolvedValue("mismatch");

      await expect(service.completeOAuthRegistration(oauthParams)).rejects.toThrow(PASS_REFUSED);

      expect(discordUserService.create).not.toHaveBeenCalled();
      expect(hook.consume).not.toHaveBeenCalled();
    });

    it("pass with no hook provided is refused with 403", async () => {
      useRegistrationMode("open");
      moduleRef.get.mockImplementation((() => {
        throw new Error("no provider");
      }) as any);
      pendingRegistrationService.get.mockResolvedValue(pendingDiscord({ pass: "code-1" }));

      await expect(service.completeOAuthRegistration(oauthParams)).rejects.toThrow(PASS_REFUSED);

      expect(discordUserService.create).not.toHaveBeenCalled();
    });

    it.each([
      ["discord", pendingDiscord()],
      ["google", pendingDiscord({ provider: "google", providerUserId: "google-123" })],
    ])("email already used (including soft-deleted) is refused with 409 before any write (%s)", async (_p, pending) => {
      useRegistrationMode("open");
      pendingRegistrationService.get.mockResolvedValue(pending);
      userRepository.findByEmail.mockResolvedValue({ ...MOCK_USER, isDeleted: true } as User);

      await expect(service.completeOAuthRegistration(oauthParams)).rejects.toThrow(
        new HttpException("This email already has an account. Sign in with it.", HttpStatus.CONFLICT),
      );

      expect(userRepository.findByEmail).toHaveBeenCalledWith({ email: "player@example.com", includeDeleted: true });
      expect(discordUserService.create).not.toHaveBeenCalled();
      expect(googleUserService.create).not.toHaveBeenCalled();
      expect(pendingRegistrationService.delete).not.toHaveBeenCalled();
    });

    it("sign-up without a pass still queues the trial, emits user.activated and returns { code }", async () => {
      useRegistrationMode("open");
      pendingRegistrationService.get.mockResolvedValue(pendingDiscord());

      const result = await service.completeOAuthRegistration(oauthParams, "en");

      expect(hook.validate).not.toHaveBeenCalled();
      expect(hook.consume).not.toHaveBeenCalled();
      expect(trialQueueService.queueTrialCreation).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(USER_ACTIVATED_EVENT, { user: MOCK_USER, language: "en" });
      expect(result).toEqual({ code: "mock-random-uuid" });
    });
  });

  describe("findPendingRegistration", () => {
    it("findPendingRegistration returns hasPass and emailInUse", async () => {
      pendingRegistrationService.get.mockResolvedValue({
        id: "pending-123",
        provider: "discord",
        providerUserId: "discord-123",
        email: "player@example.com",
        name: "Player",
        avatar: "https://cdn.discordapp.com/a.png",
        pass: "code-1",
        createdAt: "2026-10-25T00:00:00Z",
      } as PendingRegistration);
      userRepository.findByEmail.mockResolvedValue(MOCK_USER);
      const document = { data: { type: "pending-registrations", id: "pending-123" } };
      jsonApiService.buildSingle.mockResolvedValue(document);

      const result = await service.findPendingRegistration({ pendingId: "pending-123" });

      expect(userRepository.findByEmail).toHaveBeenCalledWith({ email: "player@example.com", includeDeleted: true });
      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(PendingRegistrationDescriptor.model, {
        id: "pending-123",
        name: "Player",
        email: "player@example.com",
        avatar: "https://cdn.discordapp.com/a.png",
        provider: "discord",
        hasPass: true,
        emailInUse: true,
      });
      expect(result).toBe(document);
    });

    it("findPendingRegistration reports no pass and a free email", async () => {
      pendingRegistrationService.get.mockResolvedValue({
        id: "pending-123",
        provider: "google",
        providerUserId: "google-123",
        email: "gm@example.com",
        name: "GM",
        createdAt: "2026-10-25T00:00:00Z",
      });
      userRepository.findByEmail.mockResolvedValue(null as any);

      await service.findPendingRegistration({ pendingId: "pending-123" });

      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(
        PendingRegistrationDescriptor.model,
        expect.objectContaining({ hasPass: false, emailInUse: false }),
      );
    });

    it("findPendingRegistration throws NotFoundException when expired", async () => {
      pendingRegistrationService.get.mockResolvedValue(null);

      await expect(service.findPendingRegistration({ pendingId: "gone" })).rejects.toBeInstanceOf(NotFoundException);
      expect(jsonApiService.buildSingle).not.toHaveBeenCalled();
    });
  });

  /**
   * The satellite foundation modules (TwoFactorModule, WaitlistModule,
   * DiscordUserModule, the trial queue) are @Optional() on AuthService so an
   * application can compose auth without them. These tests build the service
   * with a dependency deliberately absent — the package AuthModule still
   * provides all of them, so the default behaviour is unchanged.
   */
  describe("invite binding and signup source", () => {
    const INVITE_MISMATCH = "This invitation was sent to a different email address";

    const registerData = (attributes: Record<string, any> = {}) =>
      ({
        type: "auth",
        id: TEST_IDS.userId,
        attributes: {
          email: "gm@example.com",
          password: "password123",
          name: "Game Master",
          termsAcceptedAt: "2026-10-21T00:00:00Z",
          ...attributes,
        },
      }) as any;

    const useRegistrationMode = (registrationMode: "open" | "waitlist") =>
      configService.get.mockImplementation((key: string) => {
        if (key === "auth") return { allowRegistration: true, registrationMode };
        if (key === "app") return MOCK_APP_CONFIG;
        return undefined;
      });

    beforeEach(() => {
      userService.expectNotExists.mockResolvedValue(undefined);
      companyRepository.createByName.mockResolvedValue({ id: TEST_IDS.companyId, name: "Test Company" } as any);
      userRepository.createUser.mockResolvedValue(MOCK_USER);
    });

    describe("register", () => {
      it("register in waitlist mode rejects an email that differs from the invite", async () => {
        useRegistrationMode("waitlist");
        waitlistService.validateInviteCode.mockResolvedValue({ email: "gm@example.com", valid: true });

        await expect(
          service.register({ data: registerData({ email: "other@example.com", inviteCode: "invite-abc" }) }),
        ).rejects.toThrow(new HttpException(INVITE_MISMATCH, HttpStatus.FORBIDDEN));

        expect(userRepository.createUser).not.toHaveBeenCalled();
      });

      it("email match is case-insensitive and trimmed", async () => {
        useRegistrationMode("waitlist");
        waitlistService.validateInviteCode.mockResolvedValue({ email: "gm@example.com", valid: true });

        await expect(
          service.register({ data: registerData({ email: " GM@Example.com ", inviteCode: "invite-abc" }) }),
        ).resolves.toBeUndefined();

        expect(userRepository.createUser).toHaveBeenCalled();
      });

      it("register stores the browser source when not invited", async () => {
        useRegistrationMode("open");

        await service.register({ data: registerData({ sourceRef: "discord-embed" }) });

        expect(userRepository.setSignupSource).toHaveBeenCalledWith({
          userId: MOCK_USER.id,
          source: { sourceRef: "discord-embed" },
        });
      });

      it("invited user takes the waitlist entry source", async () => {
        useRegistrationMode("waitlist");
        waitlistService.validateInviteCode.mockResolvedValue({ email: "gm@example.com", valid: true });
        waitlistService.markAsRegistered.mockResolvedValue({ id: "entry-1", sourceUtmSource: "reddit" } as any);

        await service.register({ data: registerData({ inviteCode: "invite-abc", sourceRef: "x" }) });

        expect(userRepository.setSignupSource).toHaveBeenCalledWith({
          userId: MOCK_USER.id,
          source: { sourceUtmSource: "reddit" },
        });
      });

      it("invited user keeps the browser source when the entry has none", async () => {
        useRegistrationMode("waitlist");
        waitlistService.validateInviteCode.mockResolvedValue({ email: "gm@example.com", valid: true });
        waitlistService.markAsRegistered.mockResolvedValue({ id: "entry-1", email: "gm@example.com" } as any);

        await service.register({ data: registerData({ inviteCode: "invite-abc", sourceRef: "x" }) });

        expect(userRepository.setSignupSource).toHaveBeenCalledWith({
          userId: MOCK_USER.id,
          source: { sourceRef: "x" },
        });
      });

      it("no source anywhere → setSignupSource not called", async () => {
        useRegistrationMode("waitlist");
        waitlistService.validateInviteCode.mockResolvedValue({ email: "gm@example.com", valid: true });
        waitlistService.markAsRegistered.mockResolvedValue({ id: "entry-1", email: "gm@example.com" } as any);

        await service.register({ data: registerData({ inviteCode: "invite-abc" }) });

        expect(userRepository.setSignupSource).not.toHaveBeenCalled();
      });
    });

    describe("completeOAuthRegistration", () => {
      const oauthParams = {
        pendingId: "pending-123",
        termsAcceptedAt: "2026-10-21T00:00:00Z",
        marketingConsent: false,
        marketingConsentAt: null,
      };

      const pendingGoogle = (overrides: Partial<PendingRegistration> = {}): PendingRegistration => ({
        id: "pending-123",
        provider: "google",
        providerUserId: "google-123",
        email: "gm@example.com",
        name: "Game Master",
        inviteCode: "invite-abc",
        createdAt: "2026-10-21T00:00:00Z",
        ...overrides,
      });

      beforeEach(() => {
        useRegistrationMode("waitlist");
        waitlistService.validateInviteCode.mockResolvedValue({ email: "gm@example.com", valid: true });
        googleUserService.create.mockResolvedValue(undefined);
        userRepository.findByUserId.mockResolvedValue(MOCK_USER);
        authRepository.createSession.mockResolvedValue(MOCK_AUTH);
        jsonApiService.buildSingle.mockResolvedValue({
          data: { attributes: { refreshToken: TEST_IDS.authId } },
        });
      });

      it("OAuth completion rejects a pending email that differs from the invite", async () => {
        pendingRegistrationService.get.mockResolvedValue(pendingGoogle({ email: "x@example.com" }));

        await expect(service.completeOAuthRegistration(oauthParams)).rejects.toThrow(
          new HttpException(INVITE_MISMATCH, HttpStatus.FORBIDDEN),
        );

        expect(googleUserService.create).not.toHaveBeenCalled();
      });

      it("OAuth completion applies pending.source when the entry has none", async () => {
        pendingRegistrationService.get.mockResolvedValue(pendingGoogle({ source: { sourceRef: "discord-embed" } }));
        waitlistService.markAsRegistered.mockResolvedValue({ id: "entry-1" } as any);

        await service.completeOAuthRegistration(oauthParams);

        expect(userRepository.setSignupSource).toHaveBeenCalledWith({
          userId: "mock-random-uuid",
          source: { sourceRef: "discord-embed" },
        });
      });

      it("OAuth completion applies the waitlist entry source over pending.source", async () => {
        pendingRegistrationService.get.mockResolvedValue(pendingGoogle({ source: { sourceRef: "discord-embed" } }));
        waitlistService.markAsRegistered.mockResolvedValue({
          id: "entry-1",
          sourceUtmSource: "reddit",
          sourceUtmCampaign: "r_rpg",
        } as any);

        await service.completeOAuthRegistration(oauthParams);

        expect(userRepository.setSignupSource).toHaveBeenCalledWith({
          userId: "mock-random-uuid",
          source: { sourceUtmSource: "reddit", sourceUtmCampaign: "r_rpg" },
        });
      });
    });
  });

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
        { provide: ResponseLanguageService, useValue: createMockResponseLanguageService() },
        { provide: EventEmitter2, useValue: { emit: vi.fn() } },
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

      scopedWaitlist.validateInviteCode.mockResolvedValue({ email: REGISTER_DATA.attributes.email, valid: true });
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

  it("pins the PendingRegistration attribute set and type", () => {
    expect(Object.keys(PendingRegistrationDescriptor.fields).sort()).toEqual([
      "avatar",
      "email",
      "emailInUse",
      "hasPass",
      "name",
      "provider",
    ]);
    expect(PendingRegistrationDescriptor.relationships).toEqual({});
    expect(PendingRegistrationDescriptor.model.type).toBe("pending-registrations");
    expect(PendingRegistrationDescriptor.model.endpoint).toBe("pending-registrations");
  });
});
