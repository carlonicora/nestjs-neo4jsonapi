import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { GoogleUserService } from "../google-user.service";
import { GoogleUserRepository } from "../../repositories/google-user.repository";
import { UserRepository } from "../../../user/repositories/user.repository";
import { CompanyRepository } from "../../../company/repositories/company.repository";
import { RoleId } from "../../../../common";

// Mock crypto
vi.mock("crypto", async () => {
  const actual = await vi.importActual("crypto");
  return {
    ...actual,
    randomUUID: () => "mock-random-uuid",
  };
});

describe("GoogleUserService", () => {
  let service: GoogleUserService;
  let googleUserRepository: MockedObject<GoogleUserRepository>;
  let userRepository: MockedObject<UserRepository>;
  let companyRepository: MockedObject<CompanyRepository>;
  let clsService: MockedObject<ClsService>;

  const TEST_IDS = {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    googleId: "123456789012345678901234567890",
  };

  const MOCK_GOOGLE_USER = {
    id: TEST_IDS.googleId,
    name: "Test User",
    email: "test@gmail.com",
    picture: "https://lh3.googleusercontent.com/a/profile.jpg",
  };

  const createMockGoogleUserRepository = () => ({
    create: vi.fn(),
    findByGoogleId: vi.fn(),
    findByUserId: vi.fn(),
    delete: vi.fn(),
  });

  const createMockUserRepository = () => ({
    createUser: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });

  const createMockCompanyRepository = () => ({
    createCompanyNode: vi.fn(),
    findById: vi.fn(),
    findByCompanyId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    fetchAll: vi.fn(),
  });

  const createMockClsService = () => ({
    get: vi.fn(),
    set: vi.fn(),
    run: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleUserService,
        { provide: GoogleUserRepository, useValue: createMockGoogleUserRepository() },
        { provide: UserRepository, useValue: createMockUserRepository() },
        { provide: CompanyRepository, useValue: createMockCompanyRepository() },
        { provide: ClsService, useValue: createMockClsService() },
      ],
    }).compile();

    service = module.get<GoogleUserService>(GoogleUserService);
    googleUserRepository = module.get(GoogleUserRepository) as MockedObject<GoogleUserRepository>;
    userRepository = module.get(UserRepository) as MockedObject<UserRepository>;
    companyRepository = module.get(CompanyRepository) as MockedObject<CompanyRepository>;
    clsService = module.get(ClsService) as MockedObject<ClsService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("create", () => {
    it("should set companyId and userId in CLS service", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      googleUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: MOCK_GOOGLE_USER,
      });

      // Assert
      expect(clsService.set).toHaveBeenCalledWith("companyId", TEST_IDS.companyId);
      expect(clsService.set).toHaveBeenCalledWith("userId", TEST_IDS.userId);
    });

    it("should create company with user name as name", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      googleUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: MOCK_GOOGLE_USER,
      });

      // Assert
      expect(companyRepository.createCompanyNode).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        name: "Test User",
      });
    });

    it("should create user with google details", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      googleUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: MOCK_GOOGLE_USER,
        termsAcceptedAt: "2024-01-01T00:00:00Z",
        marketingConsent: true,
        marketingConsentAt: "2024-01-01T00:00:00Z",
      });

      // Assert
      expect(userRepository.createUser).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        email: "test@gmail.com",
        name: "Test User",
        password: "mock-random-uuid",
        companyId: TEST_IDS.companyId,
        avatar: "https://lh3.googleusercontent.com/a/profile.jpg",
        roleIds: [RoleId.CompanyAdministrator],
        isActive: true,
        termsAcceptedAt: "2024-01-01T00:00:00Z",
        marketingConsent: true,
        marketingConsentAt: "2024-01-01T00:00:00Z",
      });
    });

    it("should use google id as email when email is not available", async () => {
      // Arrange
      const googleUserWithoutEmail = { ...MOCK_GOOGLE_USER, email: undefined };
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      googleUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: googleUserWithoutEmail,
      });

      // Assert
      expect(userRepository.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: TEST_IDS.googleId,
        }),
      );
    });

    it("should create google user record", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      googleUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: MOCK_GOOGLE_USER,
      });

      // Assert
      expect(googleUserRepository.create).toHaveBeenCalledWith({
        id: TEST_IDS.userId,
        googleId: TEST_IDS.googleId,
        name: "Test User",
        user: TEST_IDS.userId,
      });
    });

    it("should handle undefined marketingConsentAt", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      googleUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: MOCK_GOOGLE_USER,
        marketingConsentAt: null,
      });

      // Assert
      expect(userRepository.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          marketingConsentAt: undefined,
        }),
      );
    });

    it("should propagate errors from company repository", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockRejectedValue(new Error("Company creation failed"));

      // Act & Assert
      await expect(
        service.create({
          userId: TEST_IDS.userId,
          companyId: TEST_IDS.companyId,
          userDetails: MOCK_GOOGLE_USER,
        }),
      ).rejects.toThrow("Company creation failed");
    });

    it("should propagate errors from user repository", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockRejectedValue(new Error("User creation failed"));

      // Act & Assert
      await expect(
        service.create({
          userId: TEST_IDS.userId,
          companyId: TEST_IDS.companyId,
          userDetails: MOCK_GOOGLE_USER,
        }),
      ).rejects.toThrow("User creation failed");
    });

    it("should propagate errors from google user repository", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      googleUserRepository.create.mockRejectedValue(new Error("Google user creation failed"));

      // Act & Assert
      await expect(
        service.create({
          userId: TEST_IDS.userId,
          companyId: TEST_IDS.companyId,
          userDetails: MOCK_GOOGLE_USER,
        }),
      ).rejects.toThrow("Google user creation failed");
    });
  });
});
