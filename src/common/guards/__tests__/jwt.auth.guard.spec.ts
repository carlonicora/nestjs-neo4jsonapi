import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { JwtAuthGuard } from "../jwt.auth.guard";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { AUTH_CONTEXT_HOOK, AuthContextHookInterface, SYSTEM_ROLES } from "../../tokens";

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

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;
  let clsService: ReturnType<typeof createMockClsService>;
  let reflector: ReturnType<typeof createMockReflector>;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

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
    neo4jService = createMockNeo4jService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: ClsService, useValue: clsService },
        { provide: Reflector, useValue: reflector },
        { provide: Neo4jService, useValue: neo4jService },
        {
          provide: SYSTEM_ROLES,
          useValue: { Administrator: TEST_IDS.adminRoleId },
        },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
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

    it("should throw Unauthorised when no user and no error", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer token" },
      });
      reflector.get.mockReturnValue([]);

      expect(() => guard.handleRequest(null, null, null, context)).toThrow(HttpException);
      expect(() => guard.handleRequest(null, null, null, context)).toThrow("Unauthorised");
    });

    it("should set CLS values for authenticated user", () => {
      const context = createMockExecutionContext({
        headers: {
          authorization: "Bearer valid-token",
          "x-language": "fr",
        },
      });
      reflector.get.mockReturnValue([]);

      const result = guard.handleRequest(null, MOCK_USER, null, context);

      expect(clsService.set).toHaveBeenCalledWith("userId", MOCK_USER.userId);
      expect(clsService.set).toHaveBeenCalledWith("companyId", MOCK_USER.companyId);
      expect(clsService.set).toHaveBeenCalledWith("language", "fr");
      expect(clsService.set).toHaveBeenCalledWith("roles", MOCK_USER.roles);
      expect(clsService.set).toHaveBeenCalledWith("token", "valid-token");
      expect(result).toEqual(MOCK_USER);
    });

    it("should strip Bearer prefix from token when setting CLS", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer my-jwt-token" },
      });
      reflector.get.mockReturnValue([]);

      guard.handleRequest(null, MOCK_USER, null, context);

      expect(clsService.set).toHaveBeenCalledWith("token", "my-jwt-token");
    });

    it("should use token as-is when no Bearer prefix", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "raw-token-no-bearer" },
      });
      reflector.get.mockReturnValue([]);

      guard.handleRequest(null, MOCK_USER, null, context);

      expect(clsService.set).toHaveBeenCalledWith("token", "raw-token-no-bearer");
    });

    it("should use x-companyid header when user has no companyId", () => {
      const userWithoutCompany = { ...MOCK_USER, companyId: undefined };
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

    it("should allow any user when no roles required", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue([]);

      const result = guard.handleRequest(null, MOCK_USER, null, context);

      expect(result).toEqual(MOCK_USER);
    });

    it("should throw Unauthorised when user lacks required roles", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue(["required-role"]);

      expect(() => guard.handleRequest(null, MOCK_USER, null, context)).toThrow(HttpException);
      expect(() => guard.handleRequest(null, MOCK_USER, null, context)).toThrow("Unauthorised");
    });

    it("should allow access when user has required role", () => {
      const userWithRequiredRole = { ...MOCK_USER, roles: ["required-role"] };
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue(["required-role"]);

      const result = guard.handleRequest(null, userWithRequiredRole, null, context);

      expect(result).toEqual(userWithRequiredRole);
    });

    it("should allow admin access to role-protected endpoints", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue(["some-other-role"]);

      // Admin should pass even if "some-other-role" is required
      const result = guard.handleRequest(null, MOCK_ADMIN_USER, null, context);

      expect(result).toEqual(MOCK_ADMIN_USER);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null roles from reflector", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue(null);

      const result = guard.handleRequest(null, MOCK_USER, null, context);

      expect(result).toEqual(MOCK_USER);
    });

    it("should handle empty roles array from reflector", () => {
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue([]);

      const result = guard.handleRequest(null, MOCK_USER, null, context);

      expect(result).toEqual(MOCK_USER);
    });

    it("should handle multiple roles in user matching one required role", () => {
      const multiRoleUser = {
        ...MOCK_USER,
        roles: ["role1", "role2", "required-role"],
      };
      const context = createMockExecutionContext({
        headers: { authorization: "Bearer valid-token" },
      });
      reflector.get.mockReturnValue(["required-role"]);

      const result = guard.handleRequest(null, multiRoleUser, null, context);

      expect(result).toEqual(multiRoleUser);
    });
  });
});

describe("JwtAuthGuard without SYSTEM_ROLES", () => {
  let guard: JwtAuthGuard;
  let clsService: ReturnType<typeof createMockClsService>;
  let reflector: ReturnType<typeof createMockReflector>;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  beforeEach(async () => {
    clsService = createMockClsService();
    reflector = createMockReflector();
    neo4jService = createMockNeo4jService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: ClsService, useValue: clsService },
        { provide: Reflector, useValue: reflector },
        { provide: Neo4jService, useValue: neo4jService },
        // No SYSTEM_ROLES provided - testing fallback
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
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
    reflector.get.mockReturnValue(["some-required-role"]);

    const result = guard.handleRequest(null, userWithAdminString, null, context);

    expect(result).toEqual(userWithAdminString);
  });
});

describe("JwtAuthGuard AUTH_CONTEXT_HOOK seam", () => {
  // The passport `AuthGuard("jwt")` mixin prototype: stubbed so `super.canActivate`
  // can report a successful authentication without a real strategy.
  const passportPrototype = Object.getPrototypeOf(JwtAuthGuard.prototype);

  let clsService: ReturnType<typeof createMockClsService>;
  let reflector: ReturnType<typeof createMockReflector>;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;
  let superCanActivate: any;

  const MOCK_USER = {
    userId: TEST_IDS.userId,
    companyId: TEST_IDS.companyId,
    roles: ["editor"],
  };

  const buildGuard = async (hook?: AuthContextHookInterface): Promise<JwtAuthGuard> => {
    const providers: any[] = [
      JwtAuthGuard,
      { provide: ClsService, useValue: clsService },
      { provide: Reflector, useValue: reflector },
      { provide: Neo4jService, useValue: neo4jService },
      {
        provide: SYSTEM_ROLES,
        useValue: { Administrator: TEST_IDS.adminRoleId },
      },
    ];

    if (hook) providers.push({ provide: AUTH_CONTEXT_HOOK, useValue: hook });

    const module: TestingModule = await Test.createTestingModule({ providers }).compile();

    return module.get<JwtAuthGuard>(JwtAuthGuard);
  };

  beforeEach(() => {
    clsService = createMockClsService();
    reflector = createMockReflector();
    neo4jService = createMockNeo4jService();
    superCanActivate = vi.spyOn(passportPrototype, "canActivate").mockResolvedValue(true);
  });

  afterEach(() => {
    superCanActivate.mockRestore();
    vi.clearAllMocks();
  });

  it("should authenticate normally when no hook is provided", async () => {
    const guard = await buildGuard();
    const context = createMockExecutionContext({
      headers: { authorization: "Bearer valid-token" },
      user: MOCK_USER,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(superCanActivate).toHaveBeenCalledTimes(1);
  });

  it("should call onAuthenticated once with request and context after successful auth", async () => {
    const onAuthenticated = vi.fn();
    const guard = await buildGuard({ onAuthenticated });
    const context = createMockExecutionContext({
      headers: { authorization: "Bearer valid-token" },
      user: MOCK_USER,
    });
    const request = context.switchToHttp().getRequest();

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
    expect(onAuthenticated).toHaveBeenCalledWith({ request, context });
  });

  it("should await an asynchronous hook before returning", async () => {
    let resolved = false;
    const onAuthenticated = vi.fn(async () => {
      await Promise.resolve();
      resolved = true;
    });
    const guard = await buildGuard({ onAuthenticated });
    const context = createMockExecutionContext({
      headers: { authorization: "Bearer valid-token" },
      user: MOCK_USER,
    });

    await guard.canActivate(context);

    expect(resolved).toBe(true);
  });

  it("should not call onAuthenticated when the authorization header is missing", async () => {
    const onAuthenticated = vi.fn();
    const guard = await buildGuard({ onAuthenticated });
    const context = createMockExecutionContext({ headers: {} });

    const result = await guard.canActivate(context);

    expect(result).toBe(false);
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(superCanActivate).not.toHaveBeenCalled();
  });

  it("should not call onAuthenticated when no user was attached to the request", async () => {
    const onAuthenticated = vi.fn();
    const guard = await buildGuard({ onAuthenticated });
    const context = createMockExecutionContext({
      headers: { authorization: "Bearer valid-token" },
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("should propagate an HttpException thrown by the hook", async () => {
    const onAuthenticated = vi.fn(() => {
      throw new HttpException("Unauthorised", 401);
    });
    const guard = await buildGuard({ onAuthenticated });
    const context = createMockExecutionContext({
      headers: { authorization: "Bearer valid-token" },
      user: MOCK_USER,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });
});
