import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ClsService } from "nestjs-cls";
import { WsJwtGuard } from "../ws.jwt.auth.guard";
import { Neo4jService } from "../../../neo4j/services/neo4j.service";

// Test IDs
const TEST_IDS = {
  userId: "660e8400-e29b-41d4-a716-446655440001",
  companyId: "550e8400-e29b-41d4-a716-446655440000",
};

// Mock factories
const createMockJwtService = () => ({
  verify: vi.fn(),
  sign: vi.fn(),
  decode: vi.fn(),
});

const createMockClsService = () => ({
  set: vi.fn(),
  get: vi.fn(),
});

const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  initQuery: vi.fn(),
});

const createMockSocket = (options: { authToken?: string; queryToken?: string; authHeader?: string }) => ({
  handshake: {
    auth: options.authToken ? { token: options.authToken } : {},
    query: options.queryToken ? { token: options.queryToken } : {},
    headers: {
      authorization: options.authHeader,
    },
  },
  data: {} as { user?: { userId: string; companyId: string; roles: string[] } },
});

const createMockWsContext = (socket: any): ExecutionContext =>
  ({
    switchToWs: () => ({
      getClient: () => socket,
      getData: () => ({}),
      getPattern: () => "",
    }),
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
      getNext: () => vi.fn(),
    }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
    getArgs: () => [],
    getArgByIndex: () => null,
    switchToRpc: () => ({}) as any,
    getType: () => "ws" as const,
  }) as ExecutionContext;

describe("WsJwtGuard", () => {
  let guard: WsJwtGuard;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let clsService: ReturnType<typeof createMockClsService>;

  const MOCK_JWT_PAYLOAD = {
    userId: TEST_IDS.userId,
    companyId: TEST_IDS.companyId,
    roles: ["editor"],
  };

  beforeEach(async () => {
    jwtService = createMockJwtService();
    clsService = createMockClsService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsJwtGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: ClsService, useValue: clsService },
        { provide: Neo4jService, useValue: createMockNeo4jService() },
      ],
    }).compile();

    guard = module.get<WsJwtGuard>(WsJwtGuard);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("canActivate", () => {
    it("should return true when valid token in handshake auth", async () => {
      const socket = createMockSocket({ authToken: "valid-token" });
      const context = createMockWsContext(socket);
      jwtService.verify.mockReturnValue(MOCK_JWT_PAYLOAD);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(jwtService.verify).toHaveBeenCalledWith("valid-token");
      expect(socket.data.user).toEqual(MOCK_JWT_PAYLOAD);
    });

    it("should return true when valid token in query", async () => {
      const socket = createMockSocket({ queryToken: "query-token" });
      const context = createMockWsContext(socket);
      jwtService.verify.mockReturnValue(MOCK_JWT_PAYLOAD);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(jwtService.verify).toHaveBeenCalledWith("query-token");
      expect(socket.data.user).toEqual(MOCK_JWT_PAYLOAD);
    });

    it("should return true when valid token in authorization header", async () => {
      const socket = createMockSocket({ authHeader: "Bearer header-token" });
      const context = createMockWsContext(socket);
      jwtService.verify.mockReturnValue(MOCK_JWT_PAYLOAD);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(jwtService.verify).toHaveBeenCalledWith("header-token");
      expect(socket.data.user).toEqual(MOCK_JWT_PAYLOAD);
    });

    it("should prefer handshake auth token over other methods", async () => {
      const socket = createMockSocket({
        authToken: "auth-token",
        queryToken: "query-token",
        authHeader: "Bearer header-token",
      });
      const context = createMockWsContext(socket);
      jwtService.verify.mockReturnValue(MOCK_JWT_PAYLOAD);

      await guard.canActivate(context);

      expect(jwtService.verify).toHaveBeenCalledWith("auth-token");
    });

    it("should prefer query token over authorization header", async () => {
      const socket = createMockSocket({
        queryToken: "query-token",
        authHeader: "Bearer header-token",
      });
      const context = createMockWsContext(socket);
      jwtService.verify.mockReturnValue(MOCK_JWT_PAYLOAD);

      await guard.canActivate(context);

      expect(jwtService.verify).toHaveBeenCalledWith("query-token");
    });

    it("should return false when no token provided", async () => {
      const socket = createMockSocket({});
      const context = createMockWsContext(socket);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it("should return false when token verification fails", async () => {
      const socket = createMockSocket({ authToken: "invalid-token" });
      const context = createMockWsContext(socket);
      jwtService.verify.mockImplementation(() => {
        throw new Error("Invalid token");
      });

      // Mock console.error to suppress output in tests
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
      expect(socket.data.user).toBeUndefined();

      consoleErrorSpy.mockRestore();
    });

    it("should return false when JWT is expired", async () => {
      const socket = createMockSocket({ authToken: "expired-token" });
      const context = createMockWsContext(socket);
      jwtService.verify.mockImplementation(() => {
        throw new Error("jwt expired");
      });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await guard.canActivate(context);

      expect(result).toBe(false);

      consoleErrorSpy.mockRestore();
    });

    it("should not strip Bearer prefix from auth.token", async () => {
      const socket = createMockSocket({ authToken: "Bearer should-not-strip" });
      const context = createMockWsContext(socket);
      jwtService.verify.mockReturnValue(MOCK_JWT_PAYLOAD);

      await guard.canActivate(context);

      // auth.token is used as-is, no Bearer stripping
      expect(jwtService.verify).toHaveBeenCalledWith("Bearer should-not-strip");
    });

    it("should strip Bearer prefix from authorization header", async () => {
      const socket = createMockSocket({ authHeader: "Bearer actual-token" });
      const context = createMockWsContext(socket);
      jwtService.verify.mockReturnValue(MOCK_JWT_PAYLOAD);

      await guard.canActivate(context);

      expect(jwtService.verify).toHaveBeenCalledWith("actual-token");
    });

    it("should return null when authorization header doesn't start with Bearer", async () => {
      const socket = createMockSocket({ authHeader: "Basic dXNlcjpwYXNz" });
      const context = createMockWsContext(socket);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
      expect(jwtService.verify).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty auth object", async () => {
      const socket = {
        handshake: {
          auth: {},
          query: {},
          headers: {},
        },
        data: {},
      };
      const context = createMockWsContext(socket);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it("should handle undefined handshake values", async () => {
      const socket = {
        handshake: {
          auth: undefined,
          query: {},
          headers: {},
        },
        data: {},
      };
      const context = createMockWsContext(socket);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it("should set user data on socket for downstream handlers", async () => {
      const socket = createMockSocket({ authToken: "valid-token" });
      const context = createMockWsContext(socket);
      jwtService.verify.mockReturnValue(MOCK_JWT_PAYLOAD);

      await guard.canActivate(context);

      expect(socket.data.user).toEqual(MOCK_JWT_PAYLOAD);
      expect(socket.data.user?.userId).toBe(TEST_IDS.userId);
      expect(socket.data.user?.companyId).toBe(TEST_IDS.companyId);
    });
  });
});
