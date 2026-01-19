import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Create mock Redis instances
const mockPublisher = {
  publish: vi.fn(),
  quit: vi.fn(),
  disconnect: vi.fn(),
};

const mockSubscriber = {
  subscribe: vi.fn(),
  on: vi.fn(),
  quit: vi.fn(),
  disconnect: vi.fn(),
};

// Track how many Redis instances have been created
let redisInstanceCount = 0;

// Mock ioredis before imports
vi.mock("ioredis", () => {
  class MockRedis {
    publish = mockPublisher.publish;
    quit = redisInstanceCount === 0 ? mockPublisher.quit : mockSubscriber.quit;
    disconnect = redisInstanceCount === 0 ? mockPublisher.disconnect : mockSubscriber.disconnect;
    subscribe = mockSubscriber.subscribe;
    on = mockSubscriber.on;

    constructor() {
      // First instance is publisher, second is subscriber
      if (redisInstanceCount === 0) {
        this.publish = mockPublisher.publish;
        this.quit = mockPublisher.quit;
        this.disconnect = mockPublisher.disconnect;
      } else {
        this.subscribe = mockSubscriber.subscribe;
        this.on = mockSubscriber.on;
        this.quit = mockSubscriber.quit;
        this.disconnect = mockSubscriber.disconnect;
      }
      redisInstanceCount++;
    }
  }
  return {
    Redis: MockRedis,
    default: MockRedis,
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { RedisMessagingService, NotificationMessage } from "../redis.messaging.service";

describe("RedisMessagingService", () => {
  let service: RedisMessagingService;
  let mockConfigService: vi.Mocked<ConfigService>;
  let mockEventEmitter: vi.Mocked<EventEmitter2>;

  const TEST_CONFIG = {
    redis: {
      host: "localhost",
      port: 6379,
      username: "",
      password: "",
      queue: "test_queue",
    },
  };

  const TEST_IDS = {
    userId: "user-123",
    companyId: "company-456",
  };

  beforeEach(async () => {
    // Reset instance count and mocks
    redisInstanceCount = 0;
    vi.clearAllMocks();

    mockPublisher.publish.mockResolvedValue(1);
    mockPublisher.quit.mockResolvedValue("OK");
    mockSubscriber.quit.mockResolvedValue("OK");

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === "redis") return TEST_CONFIG.redis;
        return undefined;
      }),
    } as any;

    mockEventEmitter = {
      emit: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisMessagingService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<RedisMessagingService>(RedisMessagingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should initialize Redis connections when config is provided", () => {
      service.onModuleInit();

      expect(mockSubscriber.subscribe).toHaveBeenCalledWith(`${TEST_CONFIG.redis.queue}:websocket_notifications`);
      expect(mockSubscriber.on).toHaveBeenCalledWith("message", expect.any(Function));
    });

    it("should not initialize when Redis config is not provided", () => {
      mockConfigService.get.mockReturnValue(undefined);

      service.onModuleInit();

      expect(mockSubscriber.subscribe).not.toHaveBeenCalled();
    });

    it("should emit redis.notification event when valid message is received", () => {
      service.onModuleInit();

      // Get the message handler callback
      const messageHandler = mockSubscriber.on.mock.calls.find((call) => call[0] === "message")?.[1];
      expect(messageHandler).toBeDefined();

      const testNotification: NotificationMessage = {
        type: "user",
        targetId: TEST_IDS.userId,
        event: "test-event",
        data: { foo: "bar" },
        timestamp: new Date(),
        source: "api",
      };

      // Simulate receiving a message on the correct channel
      messageHandler(`${TEST_CONFIG.redis.queue}:websocket_notifications`, JSON.stringify(testNotification));

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "redis.notification",
        expect.objectContaining({
          type: "user",
          targetId: TEST_IDS.userId,
          event: "test-event",
          data: { foo: "bar" },
        }),
      );
    });

    it("should ignore messages from different channels", () => {
      service.onModuleInit();

      const messageHandler = mockSubscriber.on.mock.calls.find((call) => call[0] === "message")?.[1];

      // Simulate receiving a message on a different channel
      messageHandler("other-channel", JSON.stringify({ type: "user", event: "test" }));

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it("should handle invalid JSON messages gracefully", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      service.onModuleInit();

      const messageHandler = mockSubscriber.on.mock.calls.find((call) => call[0] === "message")?.[1];

      // Simulate receiving invalid JSON
      messageHandler(`${TEST_CONFIG.redis.queue}:websocket_notifications`, "invalid-json");

      expect(consoleSpy).toHaveBeenCalledWith("Error parsing Redis notification message:", expect.any(Error));
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("publishNotification", () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it("should publish notification with timestamp and source", async () => {
      const originalEnv = process.env.APP_MODE;
      process.env.APP_MODE = "api";

      await service.publishNotification({
        type: "user",
        targetId: TEST_IDS.userId,
        event: "test-event",
        data: { test: "data" },
      });

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:websocket_notifications`,
        expect.stringContaining('"type":"user"'),
      );

      const publishedMessage = JSON.parse(mockPublisher.publish.mock.calls[0][1]);
      expect(publishedMessage.source).toBe("api");
      expect(publishedMessage.timestamp).toBeDefined();

      process.env.APP_MODE = originalEnv;
    });

    it("should set source to worker when APP_MODE is worker", async () => {
      const originalEnv = process.env.APP_MODE;
      process.env.APP_MODE = "worker";

      await service.publishNotification({
        type: "company",
        targetId: TEST_IDS.companyId,
        event: "worker-event",
        data: {},
      });

      const publishedMessage = JSON.parse(mockPublisher.publish.mock.calls[0][1]);
      expect(publishedMessage.source).toBe("worker");

      process.env.APP_MODE = originalEnv;
    });

    it("should warn and return early when publisher is not initialized", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Create a fresh service without initializing
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisMessagingService,
          { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue(undefined) } },
          { provide: EventEmitter2, useValue: mockEventEmitter },
        ],
      }).compile();

      const uninitializedService = module.get<RedisMessagingService>(RedisMessagingService);

      await uninitializedService.publishNotification({
        type: "broadcast",
        event: "test",
        data: {},
      });

      expect(consoleSpy).toHaveBeenCalledWith("RedisMessagingService: Publisher not initialized");
      consoleSpy.mockRestore();
    });
  });

  describe("publishUserNotification", () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it("should publish user notification with correct type and targetId", async () => {
      await service.publishUserNotification(TEST_IDS.userId, "user-event", { action: "created" });

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedMessage = JSON.parse(mockPublisher.publish.mock.calls[0][1]);
      expect(publishedMessage.type).toBe("user");
      expect(publishedMessage.targetId).toBe(TEST_IDS.userId);
      expect(publishedMessage.event).toBe("user-event");
      expect(publishedMessage.data).toEqual({ action: "created" });
    });
  });

  describe("publishCompanyNotification", () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it("should publish company notification with correct type and targetId", async () => {
      await service.publishCompanyNotification(TEST_IDS.companyId, "company-event", { status: "updated" });

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedMessage = JSON.parse(mockPublisher.publish.mock.calls[0][1]);
      expect(publishedMessage.type).toBe("company");
      expect(publishedMessage.targetId).toBe(TEST_IDS.companyId);
      expect(publishedMessage.event).toBe("company-event");
      expect(publishedMessage.data).toEqual({ status: "updated" });
    });
  });

  describe("publishBroadcastNotification", () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it("should publish broadcast notification without targetId", async () => {
      await service.publishBroadcastNotification("broadcast-event", { message: "hello all" });

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishedMessage = JSON.parse(mockPublisher.publish.mock.calls[0][1]);
      expect(publishedMessage.type).toBe("broadcast");
      expect(publishedMessage.targetId).toBeUndefined();
      expect(publishedMessage.event).toBe("broadcast-event");
      expect(publishedMessage.data).toEqual({ message: "hello all" });
    });
  });

  describe("onModuleDestroy", () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it("should quit both Redis connections gracefully", async () => {
      mockPublisher.quit.mockResolvedValue("OK");
      mockSubscriber.quit.mockResolvedValue("OK");

      await service.onModuleDestroy();

      expect(mockPublisher.quit).toHaveBeenCalled();
      expect(mockSubscriber.quit).toHaveBeenCalled();
    });

    it("should fallback to disconnect if publisher quit fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockPublisher.quit.mockRejectedValue(new Error("Quit failed"));
      mockSubscriber.quit.mockResolvedValue("OK");

      await service.onModuleDestroy();

      expect(mockPublisher.disconnect).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith("Error closing Redis publisher connection:", expect.any(Error));
      consoleSpy.mockRestore();
    });

    it("should fallback to disconnect if subscriber quit fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockPublisher.quit.mockResolvedValue("OK");
      mockSubscriber.quit.mockRejectedValue(new Error("Quit failed"));

      await service.onModuleDestroy();

      expect(mockSubscriber.disconnect).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith("Error closing Redis subscriber connection:", expect.any(Error));
      consoleSpy.mockRestore();
    });

    it("should handle destruction when service was never initialized", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RedisMessagingService,
          { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue(undefined) } },
          { provide: EventEmitter2, useValue: mockEventEmitter },
        ],
      }).compile();

      const uninitializedService = module.get<RedisMessagingService>(RedisMessagingService);

      // Should not throw
      await expect(uninitializedService.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});
