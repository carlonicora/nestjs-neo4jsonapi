import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { UserService } from "../user.service";
import { UserRepository } from "../../repositories/user.repository";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { EmailService } from "../../../../core/email/services/email.service";
import { UserDescriptor } from "../../entities/user";

// Mock hashPassword to avoid crypto dependencies
// `SecurityService` must be re-exported here: UserService imports UserRepository,
// which now extends AbstractRepository and pulls SecurityService into the module
// graph. A mock factory that omits it fails the whole module load.
vi.mock("../../../../core/security/services/security.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../core/security/services/security.service")>();

  return {
    ...actual,
    hashPassword: vi.fn().mockResolvedValue("hashed_password"),
  };
});

describe("UserService", () => {
  let service: UserService;
  let userRepository: MockedObject<UserRepository>;
  let jsonApiService: MockedObject<JsonApiService>;
  let emailService: MockedObject<EmailService>;
  let configService: MockedObject<ConfigService>;

  const TEST_IDS = {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    roleId: "770e8400-e29b-41d4-a716-446655440002",
    contentId: "880e8400-e29b-41d4-a716-446655440003",
  };

  const MOCK_USER = {
    id: TEST_IDS.userId,
    email: "test@example.com",
    name: "Test User",
    code: "test-code-123",
    codeExpiration: new Date("2025-12-31"),
    company: { id: TEST_IDS.companyId, name: "Test Company" },
  };

  const MOCK_JSON_API_RESPONSE = {
    data: {
      type: "users",
      id: TEST_IDS.userId,
      attributes: {
        email: "test@example.com",
        name: "Test User",
      },
    },
  };

  const MOCK_JSON_API_LIST_RESPONSE = {
    data: [MOCK_JSON_API_RESPONSE.data],
    meta: { total: 1 },
  };

  const createMockUserRepository = () => ({
    findByEmail: vi.fn(),
    findMany: vi.fn(),
    findManyByContentIds: vi.fn(),
    findManyByCompany: vi.fn(),
    findInRole: vi.fn(),
    findNotInRole: vi.fn(),
    findByUserId: vi.fn(),
    findOneForAdmin: vi.fn(),
    findFullUser: vi.fn(),
    putUser: vi.fn(),
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    reactivate: vi.fn(),
    patchRate: vi.fn(),
    resetCode: vi.fn(),
    addUserToRole: vi.fn(),
    removeUserFromRole: vi.fn(),
    makeCompanyAdmin: vi.fn(),
    onModuleInit: vi.fn(),
  });

  const createMockJsonApiService = () => ({
    buildList: vi.fn(),
    buildSingle: vi.fn(),
    buildError: vi.fn(),
  });

  const createMockEmailService = () => ({
    sendEmail: vi.fn(),
  });

  const createMockConfigService = () => ({
    get: vi.fn((key: string) => {
      if (key === "app") {
        return {
          url: "https://example.com/",
        };
      }
      return undefined;
    }),
  });

  const createMockClsService = () => ({
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn().mockReturnValue(false),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockUserRepository = createMockUserRepository();
    const mockJsonApiService = createMockJsonApiService();
    const mockEmailService = createMockEmailService();
    const mockConfigService = createMockConfigService();
    const mockClsService = createMockClsService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: JsonApiService, useValue: mockJsonApiService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockClsService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get(UserRepository) as MockedObject<UserRepository>;
    jsonApiService = module.get(JsonApiService) as MockedObject<JsonApiService>;
    emailService = module.get(EmailService) as MockedObject<EmailService>;
    configService = module.get(ConfigService) as MockedObject<ConfigService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("expectNotExists", () => {
    it("should not throw when user does not exist", async () => {
      userRepository.findByEmail.mockResolvedValue(null);

      await expect(service.expectNotExists({ email: "new@example.com" })).resolves.not.toThrow();

      expect(userRepository.findByEmail).toHaveBeenCalledWith({ email: "new@example.com" });
    });

    it("should throw HttpException with CONFLICT when user exists", async () => {
      userRepository.findByEmail.mockResolvedValue(MOCK_USER);

      await expect(service.expectNotExists({ email: "test@example.com" })).rejects.toThrow(HttpException);

      try {
        await service.expectNotExists({ email: "test@example.com" });
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
        expect((error as HttpException).message).toBe("A user with the given email already exists");
      }
    });
  });

  describe("findMany", () => {
    it("should find users with pagination", async () => {
      const mockUsers = [MOCK_USER];
      userRepository.findMany.mockResolvedValue(mockUsers);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE as any);

      const result = await service.findMany({
        query: {},
        isAdmin: false,
      });

      expect(userRepository.findMany).toHaveBeenCalledWith({
        term: undefined,
        cursor: expect.anything(),
        includeDeleted: false,
      });
      expect(jsonApiService.buildList).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSON_API_LIST_RESPONSE);
    });

    it("should pass search term when provided", async () => {
      userRepository.findMany.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] } as any);

      await service.findMany({
        query: {},
        isAdmin: false,
        term: "search term",
      });

      expect(userRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          term: "search term",
        }),
      );
    });

    it("should include deleted users when specified", async () => {
      userRepository.findMany.mockResolvedValue([]);
      jsonApiService.buildList.mockReturnValue({ data: [] } as any);

      await service.findMany({
        query: {},
        isAdmin: true,
        includeDeleted: true,
      });

      expect(userRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          includeDeleted: true,
        }),
      );
    });
  });

  describe("findByContentIds", () => {
    it("should find users by content IDs", async () => {
      userRepository.findManyByContentIds.mockResolvedValue([MOCK_USER]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE as any);

      const result = await service.findByContentIds({
        contentIds: [TEST_IDS.contentId],
        query: {},
      });

      expect(userRepository.findManyByContentIds).toHaveBeenCalledWith({
        contentIds: [TEST_IDS.contentId],
        includeDeleted: false,
        term: undefined,
      });
      expect(result).toEqual(MOCK_JSON_API_LIST_RESPONSE);
    });
  });

  describe("findManyByCompany", () => {
    it("should find users by company", async () => {
      userRepository.findManyByCompany.mockResolvedValue([MOCK_USER]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE as any);

      const result = await service.findManyByCompany({
        companyId: TEST_IDS.companyId,
        query: {},
      });

      expect(userRepository.findManyByCompany).toHaveBeenCalledWith({
        companyId: TEST_IDS.companyId,
        term: undefined,
        cursor: expect.anything(),
        includeDeleted: false,
        isDeleted: false,
      });
      expect(result).toEqual(MOCK_JSON_API_LIST_RESPONSE);
    });
  });

  describe("findInRole", () => {
    it("should find users in a role", async () => {
      userRepository.findInRole.mockResolvedValue([MOCK_USER]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE as any);

      const result = await service.findInRole({
        roleId: TEST_IDS.roleId,
        term: "search",
        query: {},
        isAdmin: false,
      });

      expect(userRepository.findInRole).toHaveBeenCalledWith({
        roleId: TEST_IDS.roleId,
        term: "search",
        cursor: expect.anything(),
      });
      expect(result).toEqual(MOCK_JSON_API_LIST_RESPONSE);
    });
  });

  describe("findNotInRole", () => {
    it("should find users not in a role", async () => {
      userRepository.findNotInRole.mockResolvedValue([MOCK_USER]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE as any);

      const result = await service.findNotInRole({
        roleId: TEST_IDS.roleId,
        term: "search",
        query: {},
        isAdmin: false,
      });

      expect(userRepository.findNotInRole).toHaveBeenCalledWith({
        roleId: TEST_IDS.roleId,
        term: "search",
        cursor: expect.anything(),
      });
      expect(result).toEqual(MOCK_JSON_API_LIST_RESPONSE);
    });
  });

  describe("findByUserId", () => {
    it("should find user by ID", async () => {
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.findByUserId({ userId: TEST_IDS.userId });

      expect(userRepository.findByUserId).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(jsonApiService.buildSingle).toHaveBeenCalled();
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });
  });

  describe("findOneForAdmin", () => {
    it("should find user for admin", async () => {
      userRepository.findOneForAdmin.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.findOneForAdmin({ userId: TEST_IDS.userId });

      expect(userRepository.findOneForAdmin).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });
  });

  describe("findByUserIdCompanyId", () => {
    it("should find user by ID and company ID", async () => {
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.findByUserIdCompanyId({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
      });

      expect(userRepository.findByUserId).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
      });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });
  });

  describe("findFullUser", () => {
    it("should find full user information", async () => {
      userRepository.findFullUser.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.findFullUser({ userId: TEST_IDS.userId });

      expect(userRepository.findFullUser).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });
  });

  describe("findByEmail", () => {
    it("should find user by email", async () => {
      userRepository.findByEmail.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.findByEmail({ email: "test@example.com" });

      expect(userRepository.findByEmail).toHaveBeenCalledWith({ email: "test@example.com" });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });
  });

  describe("put", () => {
    it("should update user with password", async () => {
      userRepository.putUser.mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.putUser({
        data: {
          id: TEST_IDS.userId,
          type: "users",
          attributes: {
            name: "Updated Name",
            password: "newpassword",
            email: "test@example.com",
          },
        },
        isAdmin: false,
        isCurrentUser: false,
      });

      expect(userRepository.putUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          name: "Updated Name",
          password: "hashed_password",
        }),
      );
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should update user name without password", async () => {
      userRepository.putUser.mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      await service.putUser({
        data: {
          id: TEST_IDS.userId,
          type: "users",
          attributes: {
            name: "Updated Name",
            email: "test@example.com",
          },
        },
        isAdmin: false,
        isCurrentUser: false,
      });

      expect(userRepository.putUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          name: "Updated Name",
          password: undefined,
        }),
      );
    });

    it("should return full user when isCurrentUser is true", async () => {
      userRepository.putUser.mockResolvedValue(undefined);
      userRepository.findFullUser.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      await service.putUser({
        data: {
          id: TEST_IDS.userId,
          type: "users",
          attributes: {
            name: "Updated Name",
            email: "test@example.com",
          },
        },
        isAdmin: false,
        isCurrentUser: true,
      });

      expect(userRepository.findFullUser).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
    });

    it("should not update if no password or name provided", async () => {
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      await service.putUser({
        data: {
          id: TEST_IDS.userId,
          type: "users",
          attributes: {
            email: "test@example.com",
          },
        },
        isAdmin: false,
        isCurrentUser: false,
      });

      expect(userRepository.putUser).not.toHaveBeenCalled();
    });

    it("should handle roles update for admin", async () => {
      userRepository.putUser.mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      await service.putUser({
        data: {
          id: TEST_IDS.userId,
          type: "users",
          attributes: {
            name: "Updated Name",
            email: "test@example.com",
          },
          relationships: {
            roles: {
              data: [{ type: "roles", id: TEST_IDS.roleId }],
            },
          },
        },
        isAdmin: true,
        isCurrentUser: false,
      });

      expect(userRepository.putUser).toHaveBeenCalledWith(
        expect.objectContaining({
          roles: [TEST_IDS.roleId],
        }),
      );
    });
  });

  describe("reactivate", () => {
    it("should reactivate user", async () => {
      userRepository.reactivate.mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.reactivate({ userId: TEST_IDS.userId });

      expect(userRepository.reactivate).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });
  });

  describe("patchRate", () => {
    it("should update user rate", async () => {
      userRepository.patchRate.mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.patchRate({
        data: {
          id: TEST_IDS.userId,
          type: "users",
          attributes: {
            rate: 150,
          },
        },
      });

      expect(userRepository.patchRate).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        rate: 150,
      });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });
  });

  describe("sendInvitationEmail", () => {
    it("should send invitation email", async () => {
      userRepository.resetCode.mockResolvedValue(MOCK_USER);
      emailService.sendEmail.mockResolvedValue(undefined);

      await service.sendInvitationEmail({ userId: TEST_IDS.userId });

      expect(userRepository.resetCode).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        "invitationEmail",
        expect.objectContaining({
          to: "test@example.com",
          activationLink: expect.stringContaining("invitation/test-code-123"),
          companyName: "Test Company",
        }),
        "en",
      );
    });
  });

  describe("create", () => {
    it("should create user with password", async () => {
      userRepository.createUser.mockResolvedValue(MOCK_USER);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.createUser({
        data: {
          id: TEST_IDS.userId,
          type: "users",
          attributes: {
            name: "New User",
            email: "new@example.com",
            password: "password123",
            adminCreated: true,
          },
          relationships: {
            company: {
              data: { type: "companies", id: TEST_IDS.companyId },
            },
          },
        },
        language: "en",
      });

      expect(userRepository.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_IDS.userId,
          name: "New User",
          email: "new@example.com",
          password: "hashed_password",
          companyId: TEST_IDS.companyId,
        }),
      );
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });

    it("should create user and send invitation email", async () => {
      userRepository.createUser.mockResolvedValue(MOCK_USER);
      emailService.sendEmail.mockResolvedValue(undefined);

      await service.createUser({
        data: {
          id: TEST_IDS.userId,
          type: "users",
          attributes: {
            name: "New User",
            email: "new@example.com",
            sendInvitationEmail: true,
          },
          relationships: {
            company: {
              data: { type: "companies", id: TEST_IDS.companyId },
            },
          },
        },
        language: "en",
      });

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        "invitationEmail",
        expect.objectContaining({
          to: "test@example.com",
        }),
        "en",
      );
    });

    it("should make company admin when forceCompanyAdmin is true", async () => {
      userRepository.createUser.mockResolvedValue(MOCK_USER);
      userRepository.makeCompanyAdmin.mockResolvedValue(undefined);

      await service.createUser({
        data: {
          id: TEST_IDS.userId,
          type: "users",
          attributes: {
            name: "New User",
            email: "new@example.com",
          },
          relationships: {
            company: {
              data: { type: "companies", id: TEST_IDS.companyId },
            },
          },
        },
        forceCompanyAdmin: true,
        language: "en",
      });

      expect(userRepository.makeCompanyAdmin).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
      });
    });
  });

  describe("createForCompany", () => {
    it("should create user for company", async () => {
      userRepository.createUser.mockResolvedValue(MOCK_USER);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.createForCompany({
        companyId: TEST_IDS.companyId,
        data: {
          id: TEST_IDS.userId,
          type: "users",
          attributes: {
            name: "New User",
            email: "new@example.com",
          },
        },
        language: "en",
      });

      expect(userRepository.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: TEST_IDS.companyId,
        }),
      );
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });
  });

  describe("delete", () => {
    it("should delete user", async () => {
      userRepository.deleteUser.mockResolvedValue(undefined);

      await service.deleteUser({ userId: TEST_IDS.userId });

      expect(userRepository.deleteUser).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
    });
  });

  describe("addUserToRole", () => {
    it("should add user to role", async () => {
      userRepository.addUserToRole.mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.addUserToRole({
        userId: TEST_IDS.userId,
        roleId: TEST_IDS.roleId,
        returnsFull: false,
      });

      expect(userRepository.addUserToRole).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        roleId: TEST_IDS.roleId,
      });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });
  });

  describe("removeUserFromRole", () => {
    it("should remove user from role", async () => {
      userRepository.removeUserFromRole.mockResolvedValue(undefined);
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      const result = await service.removeUserFromRole({
        userId: TEST_IDS.userId,
        roleId: TEST_IDS.roleId,
        returnsFull: false,
      });

      expect(userRepository.removeUserFromRole).toHaveBeenCalledWith({
        roleId: TEST_IDS.roleId,
        userId: TEST_IDS.userId,
      });
      expect(result).toEqual(MOCK_JSON_API_RESPONSE);
    });
  });

  describe("model resolution", () => {
    it("should expose the package descriptor and its model as the inherited AbstractService members", () => {
      expect(service["descriptor"]).toBe(UserDescriptor);
      expect(service["model"]).toBe(UserDescriptor.model);
    });

    it("should build single responses with this.model", async () => {
      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      await service.findByUserId({ userId: TEST_IDS.userId });

      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(UserDescriptor.model, MOCK_USER);
    });

    it("should build list responses with this.model", async () => {
      userRepository.findMany.mockResolvedValue([MOCK_USER]);
      jsonApiService.buildList.mockReturnValue(MOCK_JSON_API_LIST_RESPONSE as any);

      await service.findMany({ query: {}, isAdmin: false });

      expect(jsonApiService.buildList).toHaveBeenCalledWith(UserDescriptor.model, [MOCK_USER], expect.anything());
    });

    it("should let a subclass override the model that every package-own method serialises with", async () => {
      const EXTENDED_USER_MODEL = { ...UserDescriptor.model, isExtended: true } as any;

      // Mirrors what an application's ExtendedUserService writes: initialised
      // class-field re-declarations of `descriptor` and `model`. The field
      // initialisers run after super(...) returns, so they win over the base
      // constructor-parameter-property assignment.
      class ExtendedUserService extends UserService {
        protected readonly descriptor = { ...UserDescriptor, model: EXTENDED_USER_MODEL } as any;
        protected readonly model = EXTENDED_USER_MODEL;
      }

      const extended = new ExtendedUserService(
        jsonApiService as any,
        userRepository as any,
        emailService as any,
        configService as any,
        { get: vi.fn(), set: vi.fn(), has: vi.fn() } as any,
      );

      userRepository.findByUserId.mockResolvedValue(MOCK_USER);
      jsonApiService.buildSingle.mockReturnValue(MOCK_JSON_API_RESPONSE as any);

      await extended.findByUserId({ userId: TEST_IDS.userId });

      expect(jsonApiService.buildSingle).toHaveBeenCalledWith(EXTENDED_USER_MODEL, MOCK_USER);
    });
  });

  describe("error handling", () => {
    it("should propagate errors from repository", async () => {
      userRepository.findByEmail.mockRejectedValue(new Error("Database error"));

      await expect(service.findByEmail({ email: "test@example.com" })).rejects.toThrow("Database error");
    });

    it("should propagate errors from email service", async () => {
      userRepository.resetCode.mockResolvedValue(MOCK_USER);
      emailService.sendEmail.mockRejectedValue(new Error("Email service error"));

      await expect(service.sendInvitationEmail({ userId: TEST_IDS.userId })).rejects.toThrow("Email service error");
    });
  });
});
