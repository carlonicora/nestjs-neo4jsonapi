import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import { ClsInterceptor, ClsService } from "nestjs-cls";
import { Socket } from "socket.io";
import { EventsGateway } from "../event.gateway";
import { WebSocketService } from "../../services/websocket.service";
import { PresenceService } from "../../services/presence.service";
import { Neo4jService } from "../../../neo4j/services/neo4j.service";
import { AppLoggingService } from "../../../logging/services/logging.service";

// Stub interceptor — avoids pulling in ClsInterceptorOptions DI requirement
class NoopInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle();
  }
}

// Test IDs
const TEST_IDS = {
  userId: "660e8400-e29b-41d4-a716-446655440001",
  companyId: "550e8400-e29b-41d4-a716-446655440000",
};

const MOCK_USER = {
  userId: TEST_IDS.userId,
  companyId: TEST_IDS.companyId,
  userName: "Test User",
};

// Mock factories
const createMockJwtService = () => ({
  verify: vi.fn().mockReturnValue(MOCK_USER),
  sign: vi.fn(),
  decode: vi.fn(),
});

const createMockClsService = () => ({
  set: vi.fn(),
  get: vi.fn(),
  run: vi.fn(),
});

const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  initQuery: vi.fn(),
});

const createMockWebSocketService = () => ({
  setServer: vi.fn(),
  addClient: vi.fn(),
  removeClient: vi.fn(),
  broadcast: vi.fn().mockResolvedValue(undefined),
  handleIncomingMessage: vi.fn(),
});

const createMockPresenceService = () => ({
  setUserOnline: vi.fn().mockResolvedValue(undefined),
  setUserOffline: vi.fn().mockResolvedValue(undefined),
  getUserStatus: vi.fn().mockResolvedValue({ status: "offline", lastActivity: new Date(), socketIds: [] }),
  updateActivity: vi.fn().mockResolvedValue(undefined),
  markIdleUsersAsAway: vi.fn().mockResolvedValue([]),
});

const createMockLogger = () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  verbose: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
});

const createMockEventEmitter = () => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
});

/**
 * Creates a minimal mock Socket with the subset of Socket.IO API the gateway uses:
 * handshake token, data bag, and onAny registration.
 */
const createMockClient = (token: string | null = "valid-token"): Socket => {
  const client: any = {
    id: "socket-test-id",
    data: {},
    handshake: {
      auth: token ? { token } : {},
      query: {},
      headers: {},
    },
    onAny: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return client;
};

describe("EventsGateway", () => {
  let gateway: EventsGateway;
  let eventEmitter: ReturnType<typeof createMockEventEmitter>;
  let webSocketService: ReturnType<typeof createMockWebSocketService>;
  let presenceService: ReturnType<typeof createMockPresenceService>;
  let jwtService: ReturnType<typeof createMockJwtService>;

  beforeEach(async () => {
    eventEmitter = createMockEventEmitter();
    webSocketService = createMockWebSocketService();
    presenceService = createMockPresenceService();
    jwtService = createMockJwtService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: WebSocketService, useValue: webSocketService },
        { provide: PresenceService, useValue: presenceService },
        { provide: JwtService, useValue: jwtService },
        { provide: ClsService, useValue: createMockClsService() },
        { provide: Neo4jService, useValue: createMockNeo4jService() },
        { provide: AppLoggingService, useValue: createMockLogger() },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    })
      .overrideInterceptor(ClsInterceptor)
      .useClass(NoopInterceptor)
      .compile();

    gateway = module.get<EventsGateway>(EventsGateway);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("handleConnection — onAny forwarding", () => {
    it("registers onAny after successful auth and forwards non-built-in events to EventEmitter2", async () => {
      const client = createMockClient("valid-token");
      await gateway.handleConnection(client as unknown as Socket);

      // onAny must have been registered exactly once
      expect(client.onAny).toHaveBeenCalledTimes(1);

      // Extract the registered callback
      const onAnyCallback = (client.onAny as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
        event: string,
        payload: unknown,
      ) => void;

      // Invoke with a non-built-in event
      const chatPayload = { chatId: "c1" };
      onAnyCallback("chat:typing", chatPayload);

      expect(eventEmitter.emit).toHaveBeenCalledWith("ws:chat:typing", {
        user: client.data.user,
        payload: chatPayload,
        client,
      });
    });

    it("does NOT forward the built-in 'message' event", async () => {
      const client = createMockClient("valid-token");
      await gateway.handleConnection(client as unknown as Socket);

      const onAnyCallback = (client.onAny as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
        event: string,
        payload: unknown,
      ) => void;

      onAnyCallback("message", { type: "chat", message: "hello" });

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(expect.stringMatching(/^ws:/), expect.anything());
    });

    it("does NOT forward the built-in 'heartbeat' event", async () => {
      const client = createMockClient("valid-token");
      await gateway.handleConnection(client as unknown as Socket);

      const onAnyCallback = (client.onAny as ReturnType<typeof vi.fn>).mock.calls[0][0] as (
        event: string,
        payload: unknown,
      ) => void;

      onAnyCallback("heartbeat", undefined);

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(expect.stringMatching(/^ws:/), expect.anything());
    });

    it("does NOT register onAny when no token is present", async () => {
      const client = createMockClient(null);
      await gateway.handleConnection(client as unknown as Socket);

      expect(client.onAny).not.toHaveBeenCalled();
    });

    it("does NOT register onAny when JWT verification fails", async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error("invalid token");
      });
      const client = createMockClient("bad-token");
      await gateway.handleConnection(client as unknown as Socket);

      expect(client.onAny).not.toHaveBeenCalled();
    });
  });
});
