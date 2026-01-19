import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Server, Socket } from "socket.io";
import { WebSocketService } from "../websocket.service";
import { APP_MODE_TOKEN, AppMode, AppModeConfig } from "../../../../common/decorators/conditional-service.decorator";
import { RedisClientStorageService } from "../../../redis/services/redis.client.storage.service";
import { RedisMessagingService } from "../../../redis/services/redis.messaging.service";

describe("WebSocketService", () => {
  let service: WebSocketService;
  let eventEmitter: vi.Mocked<EventEmitter2>;
  let redisClientStorage: vi.Mocked<RedisClientStorageService>;
  let redisMessaging: vi.Mocked<RedisMessagingService>;

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
    it("should emit event with message data", () => {
      const message = { type: "chat", message: { text: "Hello" } };

      service.handleIncomingMessage(TEST_IDS.companyId, TEST_IDS.userId, message);

      expect(eventEmitter.emit).toHaveBeenCalledWith("chat", {
        companyId: TEST_IDS.companyId,
        userId: TEST_IDS.userId,
        message,
      });
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
      });

      expect(mockServer.emit).toHaveBeenCalledWith("test-event", { data: "test" });
    });

    it("should handle user notification without targetId", async () => {
      await service.handleRedisNotification({
        type: "user",
        event: "test-event",
        data: { data: "test" },
      });

      // Should not throw
    });

    it("should handle company notification without targetId", async () => {
      await service.handleRedisNotification({
        type: "company",
        event: "test-event",
        data: { data: "test" },
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
