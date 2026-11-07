import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { DiscordUserService } from "../discord-user.service";
import { DiscordUserRepository } from "../../repositories/discord-user.repository";
import { UserRepository } from "../../../user/repositories/user.repository";
import { CompanyRepository } from "../../../company/repositories/company.repository";
import { RoleId } from "../../../../common";
import { User } from "../../../user/entities/user";
import { DiscordUser } from "../../entities/discord-user";

// Mock crypto
vi.mock("crypto", async () => {
  const actual = await vi.importActual("crypto");
  return {
    ...actual,
    randomUUID: () => "mock-random-uuid",
  };
});

describe("DiscordUserService", () => {
  let service: DiscordUserService;
  let discordUserRepository: MockedObject<DiscordUserRepository>;
  let userRepository: MockedObject<UserRepository>;
  let companyRepository: MockedObject<CompanyRepository>;
  let clsService: MockedObject<ClsService>;

  const TEST_IDS = {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    discordId: "123456789012345678",
  };

  const MOCK_DISCORD_USER = {
    id: TEST_IDS.discordId,
    username: "testuser",
    email: "test@example.com",
    avatar: "https://cdn.discordapp.com/avatars/123/avatar.png",
  };

  const createMockDiscordUserRepository = () => ({
    create: vi.fn(),
    findByDiscordId: vi.fn(),
    findByUserId: vi.fn(),
    linkToUser: vi.fn(),
    delete: vi.fn(),
  });

  const createMockUserRepository = () => ({
    createUser: vi.fn(),
    findByUserId: vi.fn(),
    updateAvatar: vi.fn(),
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
        DiscordUserService,
        { provide: DiscordUserRepository, useValue: createMockDiscordUserRepository() },
        { provide: UserRepository, useValue: createMockUserRepository() },
        { provide: CompanyRepository, useValue: createMockCompanyRepository() },
        { provide: ClsService, useValue: createMockClsService() },
      ],
    }).compile();

    service = module.get<DiscordUserService>(DiscordUserService);
    discordUserRepository = module.get(DiscordUserRepository) as MockedObject<DiscordUserRepository>;
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
      discordUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: MOCK_DISCORD_USER,
      });

      // Assert
      expect(clsService.set).toHaveBeenCalledWith("companyId", TEST_IDS.companyId);
      expect(clsService.set).toHaveBeenCalledWith("userId", TEST_IDS.userId);
    });

    it("should create company with username as name", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      discordUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: MOCK_DISCORD_USER,
      });

      // Assert
      expect(companyRepository.createCompanyNode).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        name: "testuser",
      });
    });

    it("should create user with discord details", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      discordUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: MOCK_DISCORD_USER,
        termsAcceptedAt: "2024-01-01T00:00:00Z",
        marketingConsent: true,
        marketingConsentAt: "2024-01-01T00:00:00Z",
      });

      // Assert
      expect(userRepository.createUser).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        email: "test@example.com",
        name: "testuser",
        password: "mock-random-uuid",
        companyId: TEST_IDS.companyId,
        avatar: "https://cdn.discordapp.com/avatars/123/avatar.png",
        roleIds: [RoleId.CompanyAdministrator],
        isActive: true,
        termsAcceptedAt: "2024-01-01T00:00:00Z",
        marketingConsent: true,
        marketingConsentAt: "2024-01-01T00:00:00Z",
      });
    });

    it("should use discord id as email when email is not available", async () => {
      // Arrange
      const discordUserWithoutEmail = { ...MOCK_DISCORD_USER, email: undefined };
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      discordUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: discordUserWithoutEmail,
      });

      // Assert
      expect(userRepository.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: TEST_IDS.discordId,
        }),
      );
    });

    it("should create discord user record", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      discordUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: MOCK_DISCORD_USER,
      });

      // Assert
      expect(discordUserRepository.create).toHaveBeenCalledWith({
        id: TEST_IDS.userId,
        discordId: TEST_IDS.discordId,
        name: "testuser",
        user: TEST_IDS.userId,
      });
    });

    it("should handle undefined marketingConsentAt", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      discordUserRepository.create.mockResolvedValue(undefined);

      // Act
      await service.create({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        userDetails: MOCK_DISCORD_USER,
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
          userDetails: MOCK_DISCORD_USER,
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
          userDetails: MOCK_DISCORD_USER,
        }),
      ).rejects.toThrow("User creation failed");
    });

    it("should propagate errors from discord user repository", async () => {
      // Arrange
      companyRepository.createCompanyNode.mockResolvedValue(undefined);
      userRepository.createUser.mockResolvedValue(undefined);
      discordUserRepository.create.mockRejectedValue(new Error("Discord user creation failed"));

      // Act & Assert
      await expect(
        service.create({
          userId: TEST_IDS.userId,
          companyId: TEST_IDS.companyId,
          userDetails: MOCK_DISCORD_USER,
        }),
      ).rejects.toThrow("Discord user creation failed");
    });
  });
  describe("link", () => {
    const details = { ...MOCK_DISCORD_USER, avatar: "https://cdn.discordapp.com/avatars/1/a.png" };

    const userWithAvatar = (avatar: string | null): User => ({ id: TEST_IDS.userId, avatar }) as unknown as User;

    beforeEach(() => {
      discordUserRepository.linkToUser.mockResolvedValue({ id: "du-1" } as DiscordUser);
    });

    it("link does not create a user or company", async () => {
      userRepository.findByUserId.mockResolvedValue(userWithAvatar(null));

      await expect(service.link({ userId: TEST_IDS.userId, userDetails: details })).resolves.toBe("linked");

      expect(userRepository.createUser).not.toHaveBeenCalled();
      expect(companyRepository.createCompanyNode).not.toHaveBeenCalled();
      expect(discordUserRepository.create).not.toHaveBeenCalled();
      expect(discordUserRepository.linkToUser).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        discordId: details.id,
        name: details.username,
      });
    });

    it("link reads the user and sets the avatar only when shouldUseDiscordAvatar", async () => {
      userRepository.findByUserId.mockResolvedValue(userWithAvatar(""));
      await service.link({ userId: TEST_IDS.userId, userDetails: details });
      expect(userRepository.findByUserId).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(userRepository.updateAvatar).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        avatar: details.avatar,
      });

      userRepository.updateAvatar.mockClear();
      userRepository.findByUserId.mockResolvedValue(userWithAvatar("users/u/a.png"));
      await service.link({ userId: TEST_IDS.userId, userDetails: details });
      expect(userRepository.updateAvatar).not.toHaveBeenCalled();

      userRepository.findByUserId.mockResolvedValue(userWithAvatar("https://lh3.googleusercontent.com/x"));
      await service.link({ userId: TEST_IDS.userId, userDetails: details });
      expect(userRepository.updateAvatar).not.toHaveBeenCalled();
    });

    it("link replaces a Discord picture with the new Discord picture", async () => {
      userRepository.findByUserId.mockResolvedValue(userWithAvatar("https://cdn.discordapp.com/avatars/1/old.png"));

      await service.link({ userId: TEST_IDS.userId, userDetails: details });

      expect(userRepository.updateAvatar).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        avatar: details.avatar,
      });
    });

    it("link clears a Discord picture when the Discord account has none", async () => {
      userRepository.findByUserId.mockResolvedValue(userWithAvatar("https://cdn.discordapp.com/avatars/1/old.png"));

      await service.link({ userId: TEST_IDS.userId, userDetails: { ...details, avatar: null } });

      expect(userRepository.updateAvatar).toHaveBeenCalledWith({ userId: TEST_IDS.userId, avatar: null });
    });

    it("link leaves the company to the user's own BELONGS_TO: no session company is passed or set", async () => {
      userRepository.findByUserId.mockResolvedValue(userWithAvatar(null));

      await service.link({ userId: TEST_IDS.userId, userDetails: details });

      const args = discordUserRepository.linkToUser.mock.calls[0][0];
      expect(Object.keys(args).sort()).toEqual(["discordId", "name", "userId"]);
      expect(clsService.set).not.toHaveBeenCalled();
    });

    it("link returns blocked when linkToUser returns null", async () => {
      userRepository.findByUserId.mockResolvedValue(userWithAvatar(null));
      discordUserRepository.linkToUser.mockResolvedValue(null);

      await expect(service.link({ userId: TEST_IDS.userId, userDetails: details })).resolves.toBe("blocked");
      expect(userRepository.updateAvatar).not.toHaveBeenCalled();
    });
  });
});
