import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { OptionalJwtAuthGuard } from "../jwt.auth.optional.guard";
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

describe("OptionalJwtAuthGuard", () => {
  let guard: OptionalJwtAuthGuard;
  let clsService: ReturnType<typeof createMockClsService>;
  let reflector: ReturnType<typeof createMockReflector>;

  const MOCK_USER = {
    userId: TEST_IDS.userId,
    companyId: TEST_IDS.companyId,
    roles: ["editor"],
  };

  const MOCK_ADMIN_USER = {
    userId: TEST_IDS.userId,
    companyId: TEST_IDS.companyId,
    roles: [TEST_IDS.adminRoleId],
  };

  beforeEach(async () => {
    clsService = createMockClsService();
    reflector = createMockReflector();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OptionalJwtAuthGuard,
        { provide: ClsService, useValue: clsService },
        { provide: Reflector, useValue: reflector },
        {
          provide: SYSTEM_ROLES,
          useValue: { Administrator: TEST_IDS.adminRoleId },
        },
      ],
    }).compile();

    guard = module.get<OptionalJwtAuthGuard>(OptionalJwtAuthGuard);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("canActivate", () => {
    it("should return true when no auth header but user already exists", async () => {
      const context = createMockExecutionContext({
        headers: {},
        user: MOCK_USER,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe("handleRequest", () => {
    it("should return null when no token present (optional auth)", () => {
      const context = createMockExecutionContext({ headers: {} });
      reflector.getAllAndOverride.mockReturnValue([]);

      const result = guard.handleRequest(null, null, null, context);

      expect(result).toBeNull();
    });

    it("should throw Token expired when jwt expired", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer expired-token" },
      });
      reflector.getAllAndOverride.mockReturnValue([]);

      expect(() => guard.handleRequest(null, null, { message: "jwt expired" }, context)).toThrow(HttpException);
      expect(() => guard.handleRequest(null, null, { message: "jwt expired" }, context)).toThrow("Token expired");
    });

    it("should throw original error when error is provided", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer token" },
      });
      const originalError = new Error("Custom error");
      reflector.getAllAndOverride.mockReturnValue([]);

      expect(() => guard.handleRequest(originalError, null, null, context)).toThrow(originalError);
    });

    it("should return null when no user and no error (optional auth)", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer token" },
      });
      reflector.getAllAndOverride.mockReturnValue([]);

      const result = guard.handleRequest(null, null, null, context);

      expect(result).toBeNull();
    });

    it("should set CLS values for authenticated user", () => {
      const context = createMockExecutionContext({
        headers: {
          authorization: "Bearer valid-token",
          "x-language": "fr",
        },
      });
      reflector.getAllAndOverride.mockReturnValue([]);

      const result = guard.handleRequest(null, MOCK_USER, null, context);

      expect(clsService.set).toHaveBeenCalledWith("userId", MOCK_USER.userId);
      expect(clsService.set).toHaveBeenCalledWith("companyId", MOCK_USER.companyId);
      expect(clsService.set).toHaveBeenCalledWith("language", "fr");
      expect(clsService.set).toHaveBeenCalledWith("roles", MOCK_USER.roles);
      expect(result).toEqual(MOCK_USER);
    });

    it("should use x-companyid header when a system Administrator token has no companyId", () => {
      const userWithoutCompany = { ...MOCK_USER, companyId: undefined, roles: [TEST_IDS.adminRoleId] };
      const context = createMockExecutionContext({
        headers: {
          authorization: "Bearer valid-token",
          "x-companyid": "header-company-id",
        },
      });
      reflector.getAllAndOverride.mockReturnValue([]);

      guard.handleRequest(null, userWithoutCompany, null, context);

      expect(clsService.set).toHaveBeenCalledWith("companyId", "header-company-id");
    });

    it("should allow any user when no roles required", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.getAllAndOverride.mockReturnValue([]);

      const result = guard.handleRequest(null, MOCK_USER, null, context);

      expect(result).toEqual(MOCK_USER);
    });

    it("should throw Unauthorised when user lacks required roles", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.getAllAndOverride.mockReturnValue(["required-role"]);

      expect(() => guard.handleRequest(null, MOCK_USER, null, context)).toThrow(HttpException);
      expect(() => guard.handleRequest(null, MOCK_USER, null, context)).toThrow("Unauthorised");
    });

    it("should allow access when user has required role", () => {
      const userWithRequiredRole = { ...MOCK_USER, roles: ["required-role"] };
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.getAllAndOverride.mockReturnValue(["required-role"]);

      const result = guard.handleRequest(null, userWithRequiredRole, null, context);

      expect(result).toEqual(userWithRequiredRole);
    });

    it("should allow admin access to role-protected endpoints", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.getAllAndOverride.mockReturnValue(["some-other-role"]);

      const result = guard.handleRequest(null, MOCK_ADMIN_USER, null, context);

      expect(result).toEqual(MOCK_ADMIN_USER);
    });

    it("should return null when no user even if roles required (optional auth allows anonymous)", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.getAllAndOverride.mockReturnValue(["required-role"]);

      // In optional auth, when there's no user, it returns null before role validation
      // Role validation only happens when user exists
      const result = guard.handleRequest(null, null, null, context);

      expect(result).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    it("should handle null roles from reflector", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.getAllAndOverride.mockReturnValue(null);

      const result = guard.handleRequest(null, MOCK_USER, null, context);

      expect(result).toEqual(MOCK_USER);
    });

    it("should handle empty roles array from reflector", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.getAllAndOverride.mockReturnValue([]);

      const result = guard.handleRequest(null, MOCK_USER, null, context);

      expect(result).toEqual(MOCK_USER);
    });

    it("should return null without error when anonymous access with no required roles", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer token" },
      });
      reflector.getAllAndOverride.mockReturnValue([]);

      const result = guard.handleRequest(null, null, null, context);

      expect(result).toBeNull();
    });
  });
});

describe("OptionalJwtAuthGuard without SYSTEM_ROLES", () => {
  let guard: OptionalJwtAuthGuard;
  let clsService: ReturnType<typeof createMockClsService>;
  let reflector: ReturnType<typeof createMockReflector>;

  beforeEach(async () => {
    clsService = createMockClsService();
    reflector = createMockReflector();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OptionalJwtAuthGuard,
        { provide: ClsService, useValue: clsService },
        { provide: Reflector, useValue: reflector },
        // No SYSTEM_ROLES provided - testing fallback
      ],
    }).compile();

    guard = module.get<OptionalJwtAuthGuard>(OptionalJwtAuthGuard);
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
    reflector.getAllAndOverride.mockReturnValue(["some-required-role"]);

    const result = guard.handleRequest(null, userWithAdminString, null, context);

    expect(result).toEqual(userWithAdminString);
  });
});
