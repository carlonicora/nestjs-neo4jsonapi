import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Mock problematic modules before any imports
vi.mock("../../../chunker/chunker.module", () => ({
  ChunkerModule: class {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({}));

// Mock the guards to avoid dependency resolution issues
vi.mock("../../../../common/guards/jwt.auth.guard", () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = vi.fn().mockReturnValue(true);
  },
}));

// Mock the barrel export to provide only what we need
vi.mock("@carlonicora/nestjs-neo4jsonapi", () => {
  const actual = vi.importActual("@carlonicora/nestjs-neo4jsonapi");

  return {
    ...actual,
    companyMeta: {
      type: "companies",
      endpoint: "companies",
      nodeName: "company",
      labelName: "Company",
    },
  };
});

// Mock relevancy service to avoid import issues
vi.mock("../../../relevancy/services/relevancy.service", () => ({
  RelevancyService: vi.fn().mockImplementation(() => ({
    findRelevantUsers: vi.fn(),
  })),
}));

import { HttpException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { FastifyReply } from "fastify";
import { ClsService } from "nestjs-cls";
import { RoleId } from "../../../../common/constants/system.roles";
import { AuthenticatedRequest } from "../../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../../core/cache/services/cache.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { CompanyService } from "../../../company/services/company.service";
import { RelevancyService } from "../../../relevancy/services/relevancy.service";
import { UserCypherService } from "../../services/user.cypher.service";
import { UserService } from "../../services/user.service";
import { UserController } from "../user.controller";

describe("UserController", () => {
  let controller: UserController;
  let userService: vi.Mocked<UserService>;
  let securityService: vi.Mocked<SecurityService>;
  let companyService: vi.Mocked<CompanyService>;
  let cacheService: vi.Mocked<CacheService>;
  let clsService: vi.Mocked<ClsService>;
  let relevancyService: vi.Mocked<RelevancyService<any>>;
  let cypherService: vi.Mocked<UserCypherService>;
  let mockReply: vi.Mocked<FastifyReply>;

  // Test data constants
  const TEST_IDS = {
    companyId: "660e8400-e29b-41d4-a716-446655440001",
    userId: "550e8400-e29b-41d4-a716-446655440001",
    adminUserId: "550e8400-e29b-41d4-a716-446655440003",
    roleId: "770e8400-e29b-41d4-a716-446655440001",
    contentId: "880e8400-e29b-41d4-a716-446655440001",
  };

  const MOCK_USER_RESPONSE = {
    data: {
      type: "users",
      id: TEST_IDS.userId,
      attributes: {
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
      },
    },
  };

  const MOCK_USERS_LIST_RESPONSE = {
    data: [MOCK_USER_RESPONSE.data],
    meta: { total: 1 },
  };

  // Create a mock authenticated request
  const createMockRequest = (
    userId: string = TEST_IDS.userId,
    companyId: string = TEST_IDS.companyId,
    isAdmin: boolean = false,
  ): AuthenticatedRequest => {
    return {
      user: {
        userId,
        companyId,
        roles: isAdmin ? [{ id: RoleId.Administrator, name: "Administrator" }] : [],
      },
    } as AuthenticatedRequest;
  };

  // Create a mock Fastify reply
  const createMockReply = (): vi.Mocked<FastifyReply> => {
    const reply = {
      send: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as vi.Mocked<FastifyReply>;
    return reply;
  };

  beforeEach(async () => {
    const mockUserService = {
      findMany: vi.fn(),
      findByContentIds: vi.fn(),
      findByUserId: vi.fn(),
      findOneForAdmin: vi.fn(),
      findFullUser: vi.fn(),
      findByEmail: vi.fn(),
      findManyByCompany: vi.fn(),
      expectNotExists: vi.fn(),
      create: vi.fn(),
      put: vi.fn(),
      reactivate: vi.fn(),
      patchRate: vi.fn(),
      sendInvitationEmail: vi.fn(),
      delete: vi.fn(),
      findInRole: vi.fn(),
      findNotInRole: vi.fn(),
      addUserToRole: vi.fn(),
      removeUserFromRole: vi.fn(),
    };

    const mockSecurityService = {
      isUserInRoles: vi.fn(),
      validateAdmin: vi.fn(),
    };

    const mockCompanyService = {
      validate: vi.fn(),
      create: vi.fn(),
    };

    const mockCacheService = {
      invalidateByType: vi.fn(),
      invalidateByElement: vi.fn(),
    };

    const mockClsService = {
      set: vi.fn(),
      get: vi.fn(),
    };

    const mockRelevancyService = {
      findRelevantUsers: vi.fn(),
    };

    const mockCypherService = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: SecurityService, useValue: mockSecurityService },
        { provide: CompanyService, useValue: mockCompanyService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ClsService, useValue: mockClsService },
        { provide: RelevancyService, useValue: mockRelevancyService },
        { provide: UserCypherService, useValue: mockCypherService },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    userService = module.get(UserService);
    securityService = module.get(SecurityService);
    companyService = module.get(CompanyService);
    cacheService = module.get(CacheService);
    clsService = module.get(ClsService);
    relevancyService = module.get(RelevancyService);
    cypherService = module.get(UserCypherService);

    mockReply = createMockReply();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /users", () => {
    it("should find users by search as non-admin", async () => {
      const req = createMockRequest();
      const mockQuery = { page: { size: 10, number: 1 } };
      securityService.isUserInRoles.mockReturnValue(false);
      userService.findMany.mockResolvedValue(MOCK_USERS_LIST_RESPONSE);

      await controller.findBySearch(req, mockReply, mockQuery, "test", false, undefined);

      expect(userService.findMany).toHaveBeenCalledWith({
        query: mockQuery,
        term: "test",
        isAdmin: false,
        includeDeleted: false,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_USERS_LIST_RESPONSE);
    });

    it("should find users by search as admin", async () => {
      const req = createMockRequest(TEST_IDS.adminUserId, TEST_IDS.companyId, true);
      const mockQuery = {};
      securityService.isUserInRoles.mockReturnValue(true);
      userService.findMany.mockResolvedValue(MOCK_USERS_LIST_RESPONSE);

      await controller.findBySearch(req, mockReply, mockQuery, undefined, true, undefined);

      expect(userService.findMany).toHaveBeenCalledWith({
        query: mockQuery,
        term: undefined,
        isAdmin: true,
        includeDeleted: true,
      });
    });

    it("should find users by contentIds when provided", async () => {
      const req = createMockRequest();
      const mockQuery = {};
      const contentIds = "content1,content2,content3";
      securityService.isUserInRoles.mockReturnValue(false);
      userService.findByContentIds.mockResolvedValue(MOCK_USERS_LIST_RESPONSE);

      await controller.findBySearch(req, mockReply, mockQuery, undefined, false, contentIds);

      expect(userService.findByContentIds).toHaveBeenCalledWith({
        contentIds: ["content1", "content2", "content3"],
        query: mockQuery,
      });
      expect(userService.findMany).not.toHaveBeenCalled();
    });
  });

  describe("GET /users/:userId", () => {
    it("should find user by userId", async () => {
      const req = createMockRequest();
      securityService.isUserInRoles.mockReturnValue(false);
      userService.findByUserId.mockResolvedValue(MOCK_USER_RESPONSE);

      const result = await controller.findOneByUserId(req, TEST_IDS.userId);

      expect(userService.findByUserId).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(result).toEqual(MOCK_USER_RESPONSE);
    });

    it("should resolve 'me' to current user id", async () => {
      const req = createMockRequest();
      securityService.isUserInRoles.mockReturnValue(false);
      userService.findByUserId.mockResolvedValue(MOCK_USER_RESPONSE);

      await controller.findOneByUserId(req, "me");

      expect(userService.findByUserId).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
    });

    it("should use admin method for administrator", async () => {
      const req = createMockRequest(TEST_IDS.adminUserId, TEST_IDS.companyId, true);
      securityService.isUserInRoles.mockReturnValue(true);
      userService.findOneForAdmin.mockResolvedValue(MOCK_USER_RESPONSE);

      const result = await controller.findOneByUserId(req, TEST_IDS.userId);

      expect(userService.findOneForAdmin).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(result).toEqual(MOCK_USER_RESPONSE);
    });
  });

  describe("GET /users/me/full", () => {
    it("should get full user for current user", async () => {
      const req = createMockRequest();
      userService.findFullUser.mockResolvedValue(MOCK_USER_RESPONSE);

      await controller.findFullUser(req, mockReply);

      expect(userService.findFullUser).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_USER_RESPONSE);
    });
  });

  describe("GET /users/email/:email", () => {
    it("should find user by email", async () => {
      const email = "test@example.com";
      userService.findByEmail.mockResolvedValue(MOCK_USER_RESPONSE);

      const result = await controller.findOneByEmail(email);

      expect(userService.findByEmail).toHaveBeenCalledWith({ email });
      expect(result).toEqual(MOCK_USER_RESPONSE);
    });
  });

  describe("GET /companies/:companyId/users", () => {
    it("should find users by company", async () => {
      const req = createMockRequest();
      const mockQuery = {};
      userService.findManyByCompany.mockResolvedValue(MOCK_USERS_LIST_RESPONSE);

      await controller.findByCompany(req, mockReply, TEST_IDS.companyId, mockQuery, "test", false, false);

      expect(clsService.set).toHaveBeenCalledWith("companyId", TEST_IDS.companyId);
      expect(userService.findManyByCompany).toHaveBeenCalledWith({
        query: mockQuery,
        term: "test",
        isDeleted: false,
        includeDeleted: false,
        companyId: TEST_IDS.companyId,
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_USERS_LIST_RESPONSE);
    });
  });

  describe("POST /users", () => {
    const createBody = {
      data: {
        type: "users",
        attributes: {
          email: "new@example.com",
          firstName: "New",
          lastName: "User",
        },
        relationships: {
          company: {
            data: { type: "companies", id: TEST_IDS.companyId },
          },
        },
      },
      included: [],
    };

    it("should create user with existing company", async () => {
      const req = createMockRequest();
      userService.expectNotExists.mockResolvedValue(undefined);
      companyService.validate.mockResolvedValue(undefined);
      userService.create.mockResolvedValue(MOCK_USER_RESPONSE);

      await controller.createUser(req, createBody as any, mockReply, "en");

      expect(userService.expectNotExists).toHaveBeenCalledWith({ email: "new@example.com" });
      expect(companyService.validate).toHaveBeenCalledWith({ companyId: TEST_IDS.companyId });
      expect(userService.create).toHaveBeenCalledWith({
        data: createBody.data,
        forceCompanyAdmin: false,
        language: "en",
      });
      expect(mockReply.send).toHaveBeenCalledWith(MOCK_USER_RESPONSE);
      expect(cacheService.invalidateByType).toHaveBeenCalledWith("users");
    });

    it("should create user with new company and force company admin", async () => {
      const req = createMockRequest();
      const bodyWithCompany = {
        ...createBody,
        included: [{ type: "companies", attributes: { name: "New Company" } }],
      };
      userService.expectNotExists.mockResolvedValue(undefined);
      companyService.create.mockResolvedValue(undefined);
      userService.create.mockResolvedValue(MOCK_USER_RESPONSE);

      await controller.createUser(req, bodyWithCompany as any, mockReply, undefined);

      expect(companyService.create).toHaveBeenCalled();
      expect(userService.create).toHaveBeenCalledWith({
        data: bodyWithCompany.data,
        forceCompanyAdmin: true,
        language: "en",
      });
    });

    it("should return existing user if email already exists", async () => {
      const req = createMockRequest();
      userService.expectNotExists.mockRejectedValue(new Error("User exists"));
      userService.findByEmail.mockResolvedValue(MOCK_USER_RESPONSE);

      const result = await controller.createUser(req, createBody as any, mockReply, undefined);

      expect(userService.findByEmail).toHaveBeenCalledWith({ email: "new@example.com" });
      expect(result).toEqual(MOCK_USER_RESPONSE);
    });
  });

  describe("PUT /users/:userId", () => {
    const updateBody = {
      data: {
        type: "users",
        id: TEST_IDS.userId,
        attributes: {
          firstName: "Updated",
        },
      },
    };

    it("should update own user without admin check", async () => {
      const req = createMockRequest();
      securityService.isUserInRoles.mockReturnValue(false);
      userService.put.mockResolvedValue(MOCK_USER_RESPONSE);

      await controller.put(req, TEST_IDS.userId, updateBody as any, mockReply);

      expect(securityService.validateAdmin).not.toHaveBeenCalled();
      expect(userService.put).toHaveBeenCalledWith({
        data: updateBody.data,
        isAdmin: false,
        isCurrentUser: true,
      });
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("users", TEST_IDS.userId);
    });

    it("should require admin to update other users", async () => {
      const req = createMockRequest(TEST_IDS.adminUserId);
      securityService.isUserInRoles.mockReturnValue(true);
      userService.put.mockResolvedValue(MOCK_USER_RESPONSE);

      await controller.put(req, TEST_IDS.userId, updateBody as any, mockReply);

      expect(securityService.validateAdmin).toHaveBeenCalledWith({ user: req.user });
    });
  });

  describe("PATCH /users/:userId", () => {
    it("should reactivate user as admin", async () => {
      const req = createMockRequest(TEST_IDS.adminUserId, TEST_IDS.companyId, true);
      userService.reactivate.mockResolvedValue(MOCK_USER_RESPONSE);

      await controller.reactivateUser(req, TEST_IDS.userId, mockReply);

      expect(securityService.validateAdmin).toHaveBeenCalledWith({ user: req.user });
      expect(userService.reactivate).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("users", TEST_IDS.userId);
    });
  });

  describe("PATCH /users/:userId/rates", () => {
    it("should update user rates", async () => {
      const req = createMockRequest();
      const body = {
        data: {
          type: "users",
          id: TEST_IDS.userId,
          attributes: { hourlyRate: 100 },
        },
      };
      userService.patchRate.mockResolvedValue(MOCK_USER_RESPONSE);

      await controller.updateUserRates(req, TEST_IDS.userId, body as any, mockReply);

      expect(userService.patchRate).toHaveBeenCalledWith({ data: body.data });
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("users", TEST_IDS.userId);
    });
  });

  describe("POST /users/:userId/send-invitation-email", () => {
    it("should send invitation email as admin", async () => {
      const req = createMockRequest(TEST_IDS.adminUserId, TEST_IDS.companyId, true);
      userService.sendInvitationEmail.mockResolvedValue(undefined);

      await controller.sendInvitationEmail(req, TEST_IDS.userId);

      expect(securityService.validateAdmin).toHaveBeenCalledWith({ user: req.user });
      expect(userService.sendInvitationEmail).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("users", TEST_IDS.userId);
    });
  });

  describe("DELETE /users/:userId", () => {
    it("should delete user", async () => {
      userService.delete.mockResolvedValue(undefined);

      await controller.delete(TEST_IDS.userId);

      expect(userService.delete).toHaveBeenCalledWith({ userId: TEST_IDS.userId });
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("users", TEST_IDS.userId);
    });
  });

  describe("GET /roles/:roleId/users", () => {
    it("should find users in role", async () => {
      const req = createMockRequest();
      const mockQuery = {};
      securityService.isUserInRoles.mockReturnValue(false);
      userService.findInRole.mockResolvedValue(MOCK_USERS_LIST_RESPONSE);

      const result = await controller.findUserByRole(req, mockQuery, TEST_IDS.roleId, false, "test");

      expect(userService.findInRole).toHaveBeenCalledWith({
        roleId: TEST_IDS.roleId,
        term: "test",
        query: mockQuery,
        isAdmin: false,
      });
      expect(result).toEqual(MOCK_USERS_LIST_RESPONSE);
    });

    it("should find users not in role when notInRole is true", async () => {
      const req = createMockRequest();
      const mockQuery = {};
      securityService.isUserInRoles.mockReturnValue(false);
      userService.findNotInRole.mockResolvedValue(MOCK_USERS_LIST_RESPONSE);

      const result = await controller.findUserByRole(req, mockQuery, TEST_IDS.roleId, true, undefined);

      expect(userService.findNotInRole).toHaveBeenCalledWith({
        roleId: TEST_IDS.roleId,
        term: undefined,
        query: mockQuery,
        isAdmin: false,
      });
      expect(result).toEqual(MOCK_USERS_LIST_RESPONSE);
    });
  });

  describe("POST /roles/:roleId/users/:userId", () => {
    it("should add user to role as admin", async () => {
      const req = createMockRequest(TEST_IDS.adminUserId, TEST_IDS.companyId, true);
      securityService.isUserInRoles.mockReturnValue(true);
      userService.addUserToRole.mockResolvedValue(MOCK_USER_RESPONSE);

      await controller.addUserToRole(req, TEST_IDS.roleId, TEST_IDS.userId, mockReply);

      expect(userService.addUserToRole).toHaveBeenCalledWith({
        userId: TEST_IDS.userId,
        roleId: TEST_IDS.roleId,
        returnsFull: true,
      });
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("users", TEST_IDS.userId);
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("roles", TEST_IDS.roleId);
    });

    it("should allow user to add themselves to role", async () => {
      const req = createMockRequest(TEST_IDS.userId);
      securityService.isUserInRoles.mockReturnValue(false);
      userService.addUserToRole.mockResolvedValue(MOCK_USER_RESPONSE);

      await controller.addUserToRole(req, TEST_IDS.roleId, TEST_IDS.userId, mockReply);

      expect(userService.addUserToRole).toHaveBeenCalled();
    });

    it("should reject non-admin trying to add another user", async () => {
      const req = createMockRequest();
      securityService.isUserInRoles.mockReturnValue(false);

      await expect(
        controller.addUserToRole(req, TEST_IDS.roleId, "550e8400-e29b-41d4-a716-446655440099", mockReply),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("DELETE /roles/:roleId/users/:userId", () => {
    it("should remove user from role as admin", async () => {
      const req = createMockRequest(TEST_IDS.adminUserId, TEST_IDS.companyId, true);
      securityService.isUserInRoles.mockReturnValue(true);
      userService.removeUserFromRole.mockResolvedValue(undefined);

      await controller.removeUserToRole(req, TEST_IDS.roleId, TEST_IDS.userId);

      expect(userService.removeUserFromRole).toHaveBeenCalledWith({
        roleId: TEST_IDS.roleId,
        userId: TEST_IDS.userId,
        returnsFull: true,
      });
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("users", TEST_IDS.userId);
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("roles", TEST_IDS.roleId);
    });

    it("should reject non-admin trying to remove another user", async () => {
      const req = createMockRequest();
      securityService.isUserInRoles.mockReturnValue(false);

      await expect(
        controller.removeUserToRole(req, TEST_IDS.roleId, "550e8400-e29b-41d4-a716-446655440099"),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("GET /contents/:contentId/user-relevance", () => {
    it("should find relevant users for content", async () => {
      const mockQuery = {};
      relevancyService.findRelevantUsers.mockResolvedValue(MOCK_USERS_LIST_RESPONSE);

      const result = await controller.findContentsRelevantForContent(mockQuery, TEST_IDS.contentId);

      expect(relevancyService.findRelevantUsers).toHaveBeenCalledWith({
        cypherService: cypherService,
        id: TEST_IDS.contentId,
        query: mockQuery,
      });
      expect(result).toEqual(MOCK_USERS_LIST_RESPONSE);
    });
  });
});
