import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Server, Socket } from "socket.io";
import { WebSocketService, WS_CLIENT_MESSAGE_EVENT_PREFIX, WS_PRESENCE_EVENT } from "../websocket.service";
import { APP_MODE_TOKEN, AppMode, AppModeConfig } from "../../../../common/decorators/conditional-service.decorator";
import { RedisClientStorageService } from "../../../redis/services/redis.client.storage.service";
import { RedisMessagingService } from "../../../redis/services/redis.messaging.service";
import { AppLoggingService } from "../../../logging/services/logging.service";

describe("WebSocketService", () => {
  let service: WebSocketService;
  let eventEmitter: Mocked<EventEmitter2>;
  let redisClientStorage: Mocked<RedisClientStorageService>;
  let redisMessaging: Mocked<RedisMessagingService>;

  const TEST_IDS = {
    userId: "user-123",
    userId2: "user-456",
    companyId: "company-789",
    socketId: "socket-abc",
    socketId2: "socket-def",
  };

  const createMockSocket = (id: string, companyId: string): Socket => {
    const mockSocket = {
      id,
      data: {
        user: { companyId },
      },
      emit: vi.fn(),
    } as unknown as Socket;
    return mockSocket;
  };

  const createMockServer = (): Server => {
    return {
      emit: vi.fn(),
    } as unknown as Server;
  };

  const createMockAppModeConfig = (mode: AppMode = AppMode.API): AppModeConfig => ({
    mode,
    enableControllers: mode === AppMode.API,
    enableWorkers: mode === AppMode.WORKER,
    enableCronJobs: false,
  });

  const createMockRedisClientStorage = () => ({
    addClient: vi.fn().mockResolvedValue(undefined),
    removeClient: vi.fn().mockResolvedValue(undefined),
    getCompanyUsers: vi.fn().mockResolvedValue([]),
    cleanupExpiredClients: vi.fn().mockResolvedValue(undefined),
  });

  const createMockRedisMessaging = () => ({
    publishUserNotification: vi.fn().mockResolvedValue(undefined),
    publishCompanyNotification: vi.fn().mockResolvedValue(undefined),
    publishBroadcastNotification: vi.fn().mockResolvedValue(undefined),
  });

  const createMockLogger = () => ({
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    const mockEventEmitter = {
      emit: vi.fn(),
    };

    const mockRedisClientStorageValue = createMockRedisClientStorage();
    const mockRedisMessagingValue = createMockRedisMessaging();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSocketService,
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: APP_MODE_TOKEN, useValue: createMockAppModeConfig(AppMode.API) },
        { provide: AppLoggingService, useValue: createMockLogger() },
        { provide: RedisClientStorageService, useValue: mockRedisClientStorageValue },
        { provide: RedisMessagingService, useValue: mockRedisMessagingValue },
      ],
    }).compile();

    service = module.get<WebSocketService>(WebSocketService);
    eventEmitter = module.get(EventEmitter2);
    redisClientStorage = module.get(RedisClientStorageService);
    redisMessaging = module.get(RedisMessagingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("onModuleInit", () => {
    it("should set up cleanup interval", () => {
      service.onModuleInit();

      // Fast-forward 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(redisClientStorage.cleanupExpiredClients).toHaveBeenCalled();
    });

    it("should call cleanup multiple times", () => {
      service.onModuleInit();

      // Fast-forward 15 minutes (3 intervals)
      vi.advanceTimersByTime(15 * 60 * 1000);

      expect(redisClientStorage.cleanupExpiredClients).toHaveBeenCalledTimes(3);
    });
  });

  describe("setServer", () => {
    it("should set the server instance", () => {
      const mockServer = createMockServer();

      service.setServer(mockServer);

      // Verify by calling broadcast which uses the server
      service["broadcastDirect"]("test-event", { data: "test" });
      expect(mockServer.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });
  });

  describe("addClient", () => {
    it("should add client to internal map", async () => {
      const mockSocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);

      await service.addClient(TEST_IDS.userId, mockSocket);

      // Verify by sending message to user
      service["sendMessageToUserDirect"](TEST_IDS.userId, "test-event", { data: "test" });
      expect(mockSocket.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });

    it("should add multiple clients for same user", async () => {
      const mockSocket1 = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);
      const mockSocket2 = createMockSocket(TEST_IDS.socketId2, TEST_IDS.companyId);

      await service.addClient(TEST_IDS.userId, mockSocket1);
      await service.addClient(TEST_IDS.userId, mockSocket2);

      // Both sockets should receive the message
      service["sendMessageToUserDirect"](TEST_IDS.userId, "test-event", { data: "test" });
      expect(mockSocket1.emit).toHaveBeenCalledWith("test-event", { data: "test" });
      expect(mockSocket2.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });

    it("should call redisClientStorage.addClient", async () => {
      const mockSocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);

      await service.addClient(TEST_IDS.userId, mockSocket);

      expect(redisClientStorage.addClient).toHaveBeenCalledWith(TEST_IDS.userId, TEST_IDS.companyId, TEST_IDS.socketId);
    });
  });

  describe("removeClient", () => {
    it("should remove client from internal map", async () => {
      const mockSocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);
      await service.addClient(TEST_IDS.userId, mockSocket);

      await service.removeClient(TEST_IDS.userId, mockSocket);

      // Verify by sending message - should not be received
      service["sendMessageToUserDirect"](TEST_IDS.userId, "test-event", { data: "test" });
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it("should keep other clients when removing one", async () => {
      const mockSocket1 = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);
      const mockSocket2 = createMockSocket(TEST_IDS.socketId2, TEST_IDS.companyId);
      await service.addClient(TEST_IDS.userId, mockSocket1);
      await service.addClient(TEST_IDS.userId, mockSocket2);

      await service.removeClient(TEST_IDS.userId, mockSocket1);

      // Only socket2 should receive the message
      service["sendMessageToUserDirect"](TEST_IDS.userId, "test-event", { data: "test" });
      expect(mockSocket1.emit).not.toHaveBeenCalled();
      expect(mockSocket2.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });

    it("should call redisClientStorage.removeClient", async () => {
      const mockSocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);
      await service.addClient(TEST_IDS.userId, mockSocket);

      await service.removeClient(TEST_IDS.userId, mockSocket);

      expect(redisClientStorage.removeClient).toHaveBeenCalledWith(TEST_IDS.socketId);
    });

    it("should handle removing non-existent client gracefully", async () => {
      const mockSocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);

      await service.removeClient(TEST_IDS.userId, mockSocket);

      // Should not throw
      expect(redisClientStorage.removeClient).toHaveBeenCalled();
    });
  });

  describe("broadcast", () => {
    it("should broadcast directly in API mode", async () => {
      const mockServer = createMockServer();
      service.setServer(mockServer);

      await service.broadcast("test-event", { data: "test" });

      expect(mockServer.emit).toHaveBeenCalledWith("test-event", { data: "test" });
      expect(redisMessaging.publishBroadcastNotification).not.toHaveBeenCalled();
    });
  });

  describe("broadcast in WORKER mode", () => {
    let workerService: WebSocketService;

    beforeEach(async () => {
      const mockRedisClientStorageValue = createMockRedisClientStorage();
      const mockRedisMessagingValue = createMockRedisMessaging();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebSocketService,
          { provide: EventEmitter2, useValue: { emit: vi.fn() } },
          { provide: APP_MODE_TOKEN, useValue: createMockAppModeConfig(AppMode.WORKER) },
          { provide: AppLoggingService, useValue: createMockLogger() },
          { provide: RedisClientStorageService, useValue: mockRedisClientStorageValue },
          { provide: RedisMessagingService, useValue: mockRedisMessagingValue },
        ],
      }).compile();

      workerService = module.get<WebSocketService>(WebSocketService);
      redisMessaging = module.get(RedisMessagingService);
    });

    it("should use Redis messaging in WORKER mode", async () => {
      await workerService.broadcast("test-event", { data: "test" });

      expect(redisMessaging.publishBroadcastNotification).toHaveBeenCalledWith("test-event", { data: "test" });
    });
  });

  describe("sendMessageToCompany", () => {
    it("should send message to all company users in API mode", async () => {
      const mockSocket1 = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);
      const mockSocket2 = createMockSocket(TEST_IDS.socketId2, TEST_IDS.companyId);
      await service.addClient(TEST_IDS.userId, mockSocket1);
      await service.addClient(TEST_IDS.userId2, mockSocket2);

      redisClientStorage.getCompanyUsers.mockResolvedValue([TEST_IDS.userId, TEST_IDS.userId2]);

      await service.sendMessageToCompany(TEST_IDS.companyId, "test-event", { data: "test" });

      expect(mockSocket1.emit).toHaveBeenCalledWith("test-event", { data: "test" });
      expect(mockSocket2.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });
  });

  describe("sendMessageToCompany in WORKER mode", () => {
    let workerService: WebSocketService;

    beforeEach(async () => {
      const mockRedisClientStorageValue = createMockRedisClientStorage();
      const mockRedisMessagingValue = createMockRedisMessaging();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebSocketService,
          { provide: EventEmitter2, useValue: { emit: vi.fn() } },
          { provide: APP_MODE_TOKEN, useValue: createMockAppModeConfig(AppMode.WORKER) },
          { provide: AppLoggingService, useValue: createMockLogger() },
          { provide: RedisClientStorageService, useValue: mockRedisClientStorageValue },
          { provide: RedisMessagingService, useValue: mockRedisMessagingValue },
        ],
      }).compile();

      workerService = module.get<WebSocketService>(WebSocketService);
      redisMessaging = module.get(RedisMessagingService);
    });

    it("should use Redis messaging in WORKER mode", async () => {
      await workerService.sendMessageToCompany(TEST_IDS.companyId, "test-event", { data: "test" });

      expect(redisMessaging.publishCompanyNotification).toHaveBeenCalledWith(TEST_IDS.companyId, "test-event", {
        data: "test",
      });
    });
  });

  describe("sendMessageToUser", () => {
    it("should send message to specific user in API mode", async () => {
      const mockSocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);
      await service.addClient(TEST_IDS.userId, mockSocket);

      await service.sendMessageToUser(TEST_IDS.userId, "test-event", { data: "test" });

      expect(mockSocket.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });

    it("should not fail when user has no clients", async () => {
      await service.sendMessageToUser(TEST_IDS.userId, "test-event", { data: "test" });

      // Should not throw
      expect(redisMessaging.publishUserNotification).not.toHaveBeenCalled();
    });
  });

  describe("sendMessageToUser in WORKER mode", () => {
    let workerService: WebSocketService;

    beforeEach(async () => {
      const mockRedisClientStorageValue = createMockRedisClientStorage();
      const mockRedisMessagingValue = createMockRedisMessaging();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebSocketService,
          { provide: EventEmitter2, useValue: { emit: vi.fn() } },
          { provide: APP_MODE_TOKEN, useValue: createMockAppModeConfig(AppMode.WORKER) },
          { provide: AppLoggingService, useValue: createMockLogger() },
          { provide: RedisClientStorageService, useValue: mockRedisClientStorageValue },
          { provide: RedisMessagingService, useValue: mockRedisMessagingValue },
        ],
      }).compile();

      workerService = module.get<WebSocketService>(WebSocketService);
      redisMessaging = module.get(RedisMessagingService);
    });

    it("should use Redis messaging in WORKER mode", async () => {
      await workerService.sendMessageToUser(TEST_IDS.userId, "test-event", { data: "test" });

      expect(redisMessaging.publishUserNotification).toHaveBeenCalledWith(TEST_IDS.userId, "test-event", {
        data: "test",
      });
    });
  });

  describe("handleIncomingMessage", () => {
    it("should re-emit the message under the reserved ws:message: namespace", () => {
      const message = { type: "chat", message: { text: "Hello" } };

      const accepted = service.handleIncomingMessage(TEST_IDS.companyId, TEST_IDS.userId, message);

      expect(accepted).toBe(true);
      expect(WS_CLIENT_MESSAGE_EVENT_PREFIX).toBe("ws:message:");
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith("ws:message:chat", {
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
        message,
      });
    });

    it.each([
      "redis.notification",
      "company.ai.disabled",
      "ai.connections.changed",
      "token.usage.recorded",
      "user.activated",
    ])("should never emit the internal event %s verbatim", (internalEvent) => {
      service.handleIncomingMessage(TEST_IDS.companyId, TEST_IDS.userId, { type: internalEvent, message: {} });

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(internalEvent, expect.anything());
      expect(eventEmitter.emit).toHaveBeenCalledWith(`ws:message:${internalEvent}`, expect.anything());
    });

    it.each([
      ["missing type", {}],
      ["non-string type", { type: 42 }],
      ["empty type", { type: "" }],
      ["wildcard type", { type: "**" }],
      ["whitespace in type", { type: "chat message" }],
      ["overlong type", { type: "a".repeat(101) }],
    ])("should reject a message with %s and emit nothing", (_label, message) => {
      const accepted = service.handleIncomingMessage(TEST_IDS.companyId, TEST_IDS.userId, message as any);

      expect(accepted).toBe(false);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("should reject a null message frame and emit nothing", () => {
      const accepted = service.handleIncomingMessage(TEST_IDS.companyId, TEST_IDS.userId, null as any);

      expect(accepted).toBe(false);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("sendPresenceToCompany", () => {
    it("should send presence only to the sockets of the given company", async () => {
      const sameCompanySocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);
      const otherCompanySocket = createMockSocket(TEST_IDS.socketId2, "other-company");
      await service.addClient(TEST_IDS.userId, sameCompanySocket);
      await service.addClient(TEST_IDS.userId2, otherCompanySocket);
      const server = createMockServer();
      service.setServer(server);

      redisClientStorage.getCompanyUsers.mockResolvedValue([TEST_IDS.userId]);

      await service.sendPresenceToCompany(TEST_IDS.companyId, { userId: "u-x", status: "online" });

      expect(redisClientStorage.getCompanyUsers).toHaveBeenCalledWith(TEST_IDS.companyId);
      expect(sameCompanySocket.emit).toHaveBeenCalledWith(WS_PRESENCE_EVENT, { userId: "u-x", status: "online" });
      expect(otherCompanySocket.emit).not.toHaveBeenCalled();
      expect(server.emit).not.toHaveBeenCalled();
    });

    it.each([undefined, null, ""])("should send nothing when the company is %s", async (companyId) => {
      const server = createMockServer();
      service.setServer(server);

      await service.sendPresenceToCompany(companyId as any, { userId: "u-x", status: "online" });

      expect(redisClientStorage.getCompanyUsers).not.toHaveBeenCalled();
      expect(server.emit).not.toHaveBeenCalled();
    });
  });

  describe("handleIncomingGoogleMeetPart", () => {
    it("should emit googlemeet event with meeting data", () => {
      const meetId = "meet-123";
      const speakerName = "John Doe";
      const timestamp = new Date();
      const message = { transcript: "Hello world" };

      service.handleIncomingGoogleMeetPart(meetId, speakerName, timestamp, message);

      expect(eventEmitter.emit).toHaveBeenCalledWith("googlemeet", {
        meetId,
        speakerName,
        timestamp,
        message,
      });
    });
  });

  describe("handleRedisNotification", () => {
    it("should send message to user when notification type is user", async () => {
      const mockSocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);
      await service.addClient(TEST_IDS.userId, mockSocket);

      await service.handleRedisNotification({
        type: "user",
        targetId: TEST_IDS.userId,
        event: "test-event",
        data: { data: "test" },
        timestamp: new Date(),
        source: "worker",
      });

      expect(mockSocket.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });

    it("should send message to company when notification type is company", async () => {
      const mockSocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);
      await service.addClient(TEST_IDS.userId, mockSocket);
      redisClientStorage.getCompanyUsers.mockResolvedValue([TEST_IDS.userId]);

      await service.handleRedisNotification({
        type: "company",
        targetId: TEST_IDS.companyId,
        event: "test-event",
        data: { data: "test" },
        timestamp: new Date(),
        source: "worker",
      });

      expect(mockSocket.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });

    it("should broadcast when notification type is broadcast", async () => {
      const mockServer = createMockServer();
      service.setServer(mockServer);

      await service.handleRedisNotification({
        type: "broadcast",
        event: "test-event",
        data: { data: "test" },
        timestamp: new Date(),
        source: "worker",
      });

      expect(mockServer.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });

    it("should handle user notification without targetId", async () => {
      await service.handleRedisNotification({
        type: "user",
        event: "test-event",
        data: { data: "test" },
        timestamp: new Date(),
        source: "worker",
      });

      // Should not throw
    });

    it("should handle company notification without targetId", async () => {
      await service.handleRedisNotification({
        type: "company",
        event: "test-event",
        data: { data: "test" },
        timestamp: new Date(),
        source: "worker",
      });

      // Should not throw
    });
  });

  describe("without Redis services", () => {
    let serviceWithoutRedis: WebSocketService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebSocketService,
          { provide: EventEmitter2, useValue: { emit: vi.fn() } },
          { provide: APP_MODE_TOKEN, useValue: createMockAppModeConfig(AppMode.API) },
          { provide: AppLoggingService, useValue: createMockLogger() },
        ],
      }).compile();

      serviceWithoutRedis = module.get<WebSocketService>(WebSocketService);
    });

    it("addClient should work without Redis", async () => {
      const mockSocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);

      await serviceWithoutRedis.addClient(TEST_IDS.userId, mockSocket);

      // Should not throw, client should be added to local map
      serviceWithoutRedis["sendMessageToUserDirect"](TEST_IDS.userId, "test-event", { data: "test" });
      expect(mockSocket.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });

    it("removeClient should work without Redis", async () => {
      const mockSocket = createMockSocket(TEST_IDS.socketId, TEST_IDS.companyId);
      await serviceWithoutRedis.addClient(TEST_IDS.userId, mockSocket);

      await serviceWithoutRedis.removeClient(TEST_IDS.userId, mockSocket);

      // Should not throw
      serviceWithoutRedis["sendMessageToUserDirect"](TEST_IDS.userId, "test-event", { data: "test" });
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it("onModuleInit should handle missing cleanup method", () => {
      serviceWithoutRedis.onModuleInit();

      vi.advanceTimersByTime(5 * 60 * 1000);

      // Should not throw
    });

    it("sendMessageToCompanyDirect should return early without Redis", async () => {
      await serviceWithoutRedis["sendMessageToCompanyDirect"](TEST_IDS.companyId, "test-event", { data: "test" });

      // Should not throw
    });
  });
});
