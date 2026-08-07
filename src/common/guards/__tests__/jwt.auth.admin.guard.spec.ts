import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { AdminJwtAuthGuard } from "../jwt.auth.admin.guard";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SYSTEM_ROLES } from "../../tokens";

// Test IDs
const TEST_IDS = {
  userId: "660e8400-e29b-41d4-a716-446655440001",
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  adminRoleId: "53394cb8-1e87-11ef-8b48-bed54b8f8aba",
};

// Mock factories
const createMockClsService = () => ({
  set: vi.fn(),
  get: vi.fn(),
});

const createMockReflector = () => ({
  get: vi.fn(),
  getAll: vi.fn(),
  getAllAndMerge: vi.fn(),
  getAllAndOverride: vi.fn(),
});

const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  initQuery: vi.fn(),
});

const createMockExecutionContext = (options: { headers?: Record<string, string>; user?: any }): ExecutionContext => {
  const request = {
    headers: {
      authorization: options.headers?.authorization,
      "x-companyid": options.headers?.["x-companyid"],
      "x-language": options.headers?.["x-language"] ?? "en",
    },
    user: options.user,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => vi.fn(),
    }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
    getArgs: () => [],
    getArgByIndex: () => null,
    switchToRpc: () => ({}) as any,
    switchToWs: () => ({}) as any,
    getType: () => "http" as const,
  } as ExecutionContext;
};

describe("AdminJwtAuthGuard", () => {
  let guard: AdminJwtAuthGuard;
  let clsService: ReturnType<typeof createMockClsService>;
  let reflector: ReturnType<typeof createMockReflector>;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  const MOCK_ADMIN_USER = {
    userId: TEST_IDS.userId,
    companyId: TEST_IDS.companyId,
    roles: [TEST_IDS.adminRoleId],
  };

  const MOCK_REGULAR_USER = {
    userId: TEST_IDS.userId,
    companyId: TEST_IDS.companyId,
    roles: ["some-other-role"],
  };

  beforeEach(async () => {
    clsService = createMockClsService();
    reflector = createMockReflector();
    neo4jService = createMockNeo4jService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminJwtAuthGuard,
        { provide: ClsService, useValue: clsService },
        { provide: Reflector, useValue: reflector },
        { provide: Neo4jService, useValue: neo4jService },
        {
          provide: SYSTEM_ROLES,
          useValue: { Administrator: TEST_IDS.adminRoleId },
        },
      ],
    }).compile();

    guard = module.get<AdminJwtAuthGuard>(AdminJwtAuthGuard);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("canActivate", () => {
    it("should return false when no authorization header present", async () => {
      const context = createMockExecutionContext({ headers: {} });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe("handleRequest", () => {
    it("should throw Unauthorised when no token present", () => {
      const context = createMockExecutionContext({ headers: {} });
      reflector.get.mockReturnValue([]);

      expect(() => guard.handleRequest(null, null, null, context)).toThrow(HttpException);
      expect(() => guard.handleRequest(null, null, null, context)).toThrow("Unauthorised");
    });

    it("should throw Token expired when jwt expired", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer expired-token" },
      });
      reflector.get.mockReturnValue([]);

      expect(() => guard.handleRequest(null, null, { message: "jwt expired" }, context)).toThrow(HttpException);
      expect(() => guard.handleRequest(null, null, { message: "jwt expired" }, context)).toThrow("Token expired");
    });

    it("should throw original error when error is provided", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer token" },
      });
      const originalError = new Error("Custom error");
      reflector.get.mockReturnValue([]);

      expect(() => guard.handleRequest(originalError, null, null, context)).toThrow(originalError);
    });

    // SECURITY REGRESSION GUARD. This previously asserted `toBeNull()`, which
    // encoded an auth bypass: AuthGuard.canActivate assigns the return value to
    // request.user and then returns true unconditionally, so a null return
    // ADMITTED the caller and skipped _validateRoles entirely. Reached with any
    // token passport rejects for a reason other than expiry — a forged
    // signature or a malformed JWT — on every route this guard protects.
    it("should THROW 401 when a token is present but yields no user and no error", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer forged-or-malformed" },
      });
      reflector.get.mockReturnValue([]);

      expect(() => guard.handleRequest(null, null, null, context)).toThrow(HttpException);
      expect(() => guard.handleRequest(null, null, null, context)).toThrow("Unauthorised");
    });

    it("should set CLS values for admin user", () => {
      const context = createMockExecutionContext({
        headers: {
          authorization: "Bearer valid-token",
          "x-language": "fr",
        },
      });
      reflector.get.mockReturnValue([]);

      const result = guard.handleRequest(null, MOCK_ADMIN_USER, null, context);

      expect(clsService.set).toHaveBeenCalledWith("userId", MOCK_ADMIN_USER.userId);
      expect(clsService.set).toHaveBeenCalledWith("companyId", MOCK_ADMIN_USER.companyId);
      expect(clsService.set).toHaveBeenCalledWith("language", "fr");
      expect(clsService.set).toHaveBeenCalledWith("roles", MOCK_ADMIN_USER.roles);
      expect(result).toEqual(MOCK_ADMIN_USER);
    });

    it("should use x-companyid header when user has no companyId", () => {
      const userWithoutCompany = { ...MOCK_ADMIN_USER, companyId: undefined };
      const context = createMockExecutionContext({
        headers: {
          authorization: "Bearer valid-token",
          "x-companyid": "header-company-id",
        },
      });
      reflector.get.mockReturnValue([]);

      guard.handleRequest(null, userWithoutCompany, null, context);

      expect(clsService.set).toHaveBeenCalledWith("companyId", "header-company-id");
    });

    it("should throw Unauthorised when user lacks required roles", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue([]);

      expect(() => guard.handleRequest(null, MOCK_REGULAR_USER, null, context)).toThrow(HttpException);
      expect(() => guard.handleRequest(null, MOCK_REGULAR_USER, null, context)).toThrow("Unauthorised");
    });

    it("should allow access when user has required role from decorator", () => {
      const customRoleUser = {
        ...MOCK_REGULAR_USER,
        roles: ["custom-required-role"],
      };
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue(["custom-required-role"]);

      const result = guard.handleRequest(null, customRoleUser, null, context);

      expect(result).toEqual(customRoleUser);
    });

    it("should always add admin role to required roles check", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue(["some-other-role"]);

      // Admin user should pass even if "some-other-role" is required
      // because admin role is always added
      const result = guard.handleRequest(null, MOCK_ADMIN_USER, null, context);

      expect(result).toEqual(MOCK_ADMIN_USER);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty roles array from reflector", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue(null);

      // Admin user should still pass with admin role
      const result = guard.handleRequest(null, MOCK_ADMIN_USER, null, context);

      expect(result).toEqual(MOCK_ADMIN_USER);
    });

    it("should handle multiple roles in user", () => {
      const multiRoleUser = {
        ...MOCK_REGULAR_USER,
        roles: ["role1", "role2", TEST_IDS.adminRoleId],
      };
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue([]);

      const result = guard.handleRequest(null, multiRoleUser, null, context);

      expect(result).toEqual(multiRoleUser);
    });
  });
});

describe("AdminJwtAuthGuard without SYSTEM_ROLES", () => {
  let guard: AdminJwtAuthGuard;
  let clsService: ReturnType<typeof createMockClsService>;
  let reflector: ReturnType<typeof createMockReflector>;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  beforeEach(async () => {
    clsService = createMockClsService();
    reflector = createMockReflector();
    neo4jService = createMockNeo4jService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminJwtAuthGuard,
        { provide: ClsService, useValue: clsService },
        { provide: Reflector, useValue: reflector },
        { provide: Neo4jService, useValue: neo4jService },
        // No SYSTEM_ROLES provided - testing fallback
      ],
    }).compile();

    guard = module.get<AdminJwtAuthGuard>(AdminJwtAuthGuard);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should fall back to 'administrator' string when SYSTEM_ROLES not provided", () => {
    const userWithAdminString = {
      userId: TEST_IDS.userId,
      companyId: TEST_IDS.companyId,
      roles: ["administrator"],
    };
    const context = createMockExecutionContext({
      headers: { authorization: "Bearer valid-token" },
    });
    reflector.get.mockReturnValue([]);

    const result = guard.handleRequest(null, userWithAdminString, null, context);

    expect(result).toEqual(userWithAdminString);
  });
});
