import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Create mock functions for the Redis pipeline
const mockPipeline = {
  hset: vi.fn().mockReturnThis(),
  sadd: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  del: vi.fn().mockReturnThis(),
  srem: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([]),
};

// Create mock Redis instance with all methods needed by the service
const mockRedisInstance = {
  _status: "ready" as string,
  get status() {
    return this._status;
  },
  set status(value: string) {
    this._status = value;
  },
  hgetall: vi.fn(),
  smembers: vi.fn(),
  keys: vi.fn(),
  exists: vi.fn(),
  srem: vi.fn(),
  pipeline: vi.fn().mockReturnValue(mockPipeline),
  quit: vi.fn(),
  disconnect: vi.fn(),
};

// Mock ioredis before imports
vi.mock("ioredis", () => {
  class MockRedis {
    get status() {
      return mockRedisInstance._status;
    }
    hgetall = mockRedisInstance.hgetall;
    smembers = mockRedisInstance.smembers;
    keys = mockRedisInstance.keys;
    exists = mockRedisInstance.exists;
    srem = mockRedisInstance.srem;
    pipeline = mockRedisInstance.pipeline;
    quit = mockRedisInstance.quit;
    disconnect = mockRedisInstance.disconnect;
  }
  return {
    Redis: MockRedis,
    default: MockRedis,
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { RedisClientStorageService } from "../redis.client.storage.service";

describe("RedisClientStorageService", () => {
  let service: RedisClientStorageService;
  let mockConfigService: vi.Mocked<ConfigService>;

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
    socketId: "socket-789",
    socketId2: "socket-999",
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    mockPipeline.hset.mockReturnThis();
    mockPipeline.sadd.mockReturnThis();
    mockPipeline.expire.mockReturnThis();
    mockPipeline.del.mockReturnThis();
    mockPipeline.srem.mockReturnThis();
    mockPipeline.exec.mockResolvedValue([]);
    mockRedisInstance._status = "ready";
    mockRedisInstance.quit.mockResolvedValue("OK");

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === "redis") return TEST_CONFIG.redis;
        return undefined;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [RedisClientStorageService, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get<RedisClientStorageService>(RedisClientStorageService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getRedisClient", () => {
    it("should return the Redis client instance", () => {
      const client = service.getRedisClient();

      expect(client).toBeDefined();
      expect(typeof client.hgetall).toBe("function");
      expect(typeof client.pipeline).toBe("function");
    });
  });

  describe("isConnected", () => {
    it("should return true when status is ready", () => {
      mockRedisInstance._status = "ready";

      const result = service.isConnected();

      expect(result).toBe(true);
    });

    it("should return true when status is connect", () => {
      mockRedisInstance._status = "connect";

      const result = service.isConnected();

      expect(result).toBe(true);
    });

    it("should return false when status is not ready or connect", () => {
      mockRedisInstance._status = "close";

      const result = service.isConnected();

      expect(result).toBe(false);
    });
  });

  describe("addClient", () => {
    it("should store client info in Redis using pipeline", async () => {
      await service.addClient(TEST_IDS.userId, TEST_IDS.companyId, TEST_IDS.socketId);

      expect(mockRedisInstance.pipeline).toHaveBeenCalled();
      expect(mockPipeline.hset).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:ws_client:${TEST_IDS.socketId}`,
        "userId",
        TEST_IDS.userId,
        "companyId",
        TEST_IDS.companyId,
        "connectedAt",
        expect.any(String),
      );
      expect(mockPipeline.sadd).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:user_clients:${TEST_IDS.userId}`,
        TEST_IDS.socketId,
      );
      expect(mockPipeline.sadd).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:company_users:${TEST_IDS.companyId}`,
        TEST_IDS.userId,
      );
      expect(mockPipeline.expire).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:ws_client:${TEST_IDS.socketId}`,
        24 * 60 * 60,
      );
      expect(mockPipeline.expire).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:user_clients:${TEST_IDS.userId}`,
        24 * 60 * 60,
      );
      expect(mockPipeline.expire).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:company_users:${TEST_IDS.companyId}`,
        24 * 60 * 60,
      );
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe("removeClient", () => {
    it("should remove client and associated data when client exists", async () => {
      // Mock getClientInfo to return existing client
      mockRedisInstance.hgetall.mockResolvedValue({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        connectedAt: new Date().toISOString(),
      });
      // Mock getUserClients to return only this socket (should remove from company)
      mockRedisInstance.smembers.mockResolvedValue([TEST_IDS.socketId]);

      await service.removeClient(TEST_IDS.socketId);

      expect(mockPipeline.del).toHaveBeenCalledWith(`${TEST_CONFIG.redis.queue}:ws_client:${TEST_IDS.socketId}`);
      expect(mockPipeline.srem).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:user_clients:${TEST_IDS.userId}`,
        TEST_IDS.socketId,
      );
      // User has only 1 client, so should be removed from company
      expect(mockPipeline.srem).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:company_users:${TEST_IDS.companyId}`,
        TEST_IDS.userId,
      );
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it("should not remove user from company when user has other clients", async () => {
      mockRedisInstance.hgetall.mockResolvedValue({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        connectedAt: new Date().toISOString(),
      });
      // User has 2 clients
      mockRedisInstance.smembers.mockResolvedValue([TEST_IDS.socketId, TEST_IDS.socketId2]);

      await service.removeClient(TEST_IDS.socketId);

      // Should NOT remove user from company since they have another client
      expect(mockPipeline.srem).toHaveBeenCalledTimes(1);
      expect(mockPipeline.srem).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:user_clients:${TEST_IDS.userId}`,
        TEST_IDS.socketId,
      );
    });

    it("should do nothing when client does not exist", async () => {
      mockRedisInstance.hgetall.mockResolvedValue({});

      await service.removeClient(TEST_IDS.socketId);

      expect(mockPipeline.del).not.toHaveBeenCalled();
    });

    it("should handle Redis errors gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedisInstance.hgetall.mockRejectedValue(new Error("Connection error"));

      await service.removeClient(TEST_IDS.socketId);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getClientInfo", () => {
    it("should return client info when client exists", async () => {
      const connectedAt = new Date().toISOString();
      mockRedisInstance.hgetall.mockResolvedValue({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        connectedAt,
      });

      const result = await service.getClientInfo(TEST_IDS.socketId);

      expect(result).toEqual({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        socketId: TEST_IDS.socketId,
        connectedAt: new Date(connectedAt),
      });
    });

    it("should return null when client does not exist", async () => {
      mockRedisInstance.hgetall.mockResolvedValue({});

      const result = await service.getClientInfo(TEST_IDS.socketId);

      expect(result).toBeNull();
    });

    it("should return null and log error on Redis error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedisInstance.hgetall.mockRejectedValue(new Error("Redis error"));

      const result = await service.getClientInfo(TEST_IDS.socketId);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getUserClients", () => {
    it("should return list of socket IDs for user", async () => {
      mockRedisInstance.smembers.mockResolvedValue([TEST_IDS.socketId, TEST_IDS.socketId2]);

      const result = await service.getUserClients(TEST_IDS.userId);

      expect(mockRedisInstance.smembers).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:user_clients:${TEST_IDS.userId}`,
      );
      expect(result).toEqual([TEST_IDS.socketId, TEST_IDS.socketId2]);
    });

    it("should return empty array when user has no clients", async () => {
      mockRedisInstance.smembers.mockResolvedValue([]);

      const result = await service.getUserClients(TEST_IDS.userId);

      expect(result).toEqual([]);
    });

    it("should return empty array on Redis error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedisInstance.smembers.mockRejectedValue(new Error("Redis error"));

      const result = await service.getUserClients(TEST_IDS.userId);

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getCompanyUsers", () => {
    it("should return list of user IDs for company", async () => {
      mockRedisInstance.smembers.mockResolvedValue([TEST_IDS.userId, "user-999"]);

      const result = await service.getCompanyUsers(TEST_IDS.companyId);

      expect(mockRedisInstance.smembers).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:company_users:${TEST_IDS.companyId}`,
      );
      expect(result).toEqual([TEST_IDS.userId, "user-999"]);
    });
  });

  describe("getUserCompany", () => {
    it("should return company ID when user has clients", async () => {
      mockRedisInstance.smembers.mockResolvedValue([TEST_IDS.socketId]);
      mockRedisInstance.hgetall.mockResolvedValue({
        userId: TEST_IDS.userId,
        companyId: TEST_IDS.companyId,
        connectedAt: new Date().toISOString(),
      });

      const result = await service.getUserCompany(TEST_IDS.userId);

      expect(result).toBe(TEST_IDS.companyId);
    });

    it("should return null when user has no clients", async () => {
      mockRedisInstance.smembers.mockResolvedValue([]);

      const result = await service.getUserCompany(TEST_IDS.userId);

      expect(result).toBeNull();
    });

    it("should return null when client info not found", async () => {
      mockRedisInstance.smembers.mockResolvedValue([TEST_IDS.socketId]);
      mockRedisInstance.hgetall.mockResolvedValue({});

      const result = await service.getUserCompany(TEST_IDS.userId);

      expect(result).toBeNull();
    });
  });

  describe("getAllConnectedUsers", () => {
    it("should return all connected user IDs", async () => {
      mockRedisInstance.keys.mockResolvedValue([
        `${TEST_CONFIG.redis.queue}:user_clients:user-1`,
        `${TEST_CONFIG.redis.queue}:user_clients:user-2`,
      ]);

      const result = await service.getAllConnectedUsers();

      expect(mockRedisInstance.keys).toHaveBeenCalledWith(`${TEST_CONFIG.redis.queue}:user_clients:*`);
      expect(result).toEqual(["user-1", "user-2"]);
    });

    it("should return empty array when no users connected", async () => {
      mockRedisInstance.keys.mockResolvedValue([]);

      const result = await service.getAllConnectedUsers();

      expect(result).toEqual([]);
    });
  });

  describe("cleanupExpiredClients", () => {
    it("should remove orphaned socket references", async () => {
      mockRedisInstance.keys.mockResolvedValueOnce([`${TEST_CONFIG.redis.queue}:user_clients:${TEST_IDS.userId}`]);
      mockRedisInstance.smembers
        .mockResolvedValueOnce([TEST_IDS.socketId, "orphan-socket"])
        .mockResolvedValueOnce([TEST_IDS.socketId]); // After cleanup, one socket remains

      // First socket exists, second doesn't
      mockRedisInstance.exists.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await service.cleanupExpiredClients();

      // Should remove orphaned socket
      expect(mockRedisInstance.srem).toHaveBeenCalledWith(
        `${TEST_CONFIG.redis.queue}:user_clients:${TEST_IDS.userId}`,
        "orphan-socket",
      );
    });

    it("should remove user from all companies when user has no remaining clients", async () => {
      mockRedisInstance.keys
        .mockResolvedValueOnce([`${TEST_CONFIG.redis.queue}:user_clients:${TEST_IDS.userId}`])
        .mockResolvedValueOnce([`${TEST_CONFIG.redis.queue}:company_users:${TEST_IDS.companyId}`]);
      mockRedisInstance.smembers.mockResolvedValueOnce(["orphan-socket"]).mockResolvedValueOnce([]); // No remaining clients

      mockRedisInstance.exists.mockResolvedValue(0); // Socket doesn't exist

      await service.cleanupExpiredClients();

      // Should trigger pipeline to remove user from companies
      expect(mockPipeline.srem).toHaveBeenCalled();
      expect(mockPipeline.del).toHaveBeenCalled();
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe("onModuleDestroy", () => {
    it("should quit Redis connection gracefully", async () => {
      mockRedisInstance.quit.mockResolvedValue("OK");

      await service.onModuleDestroy();

      expect(mockRedisInstance.quit).toHaveBeenCalled();
    });

    it("should fallback to disconnect if quit fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRedisInstance.quit.mockRejectedValue(new Error("Quit failed"));

      await service.onModuleDestroy();

      expect(mockRedisInstance.disconnect).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
