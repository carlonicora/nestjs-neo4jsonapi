import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Create mock functions that we can reference
const mockPipeline = {
  sadd: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  del: vi.fn().mockReturnThis(),
  srem: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([]),
};

const mockRedisInstance = {
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
  smembers: vi.fn(),
  pipeline: vi.fn().mockReturnValue(mockPipeline),
  quit: vi.fn(),
  disconnect: vi.fn(),
};

// Mock ioredis before imports - use a class that can be instantiated with new
vi.mock("ioredis", () => {
  class MockRedis {
    get = mockRedisInstance.get;
    setex = mockRedisInstance.setex;
    del = mockRedisInstance.del;
    keys = mockRedisInstance.keys;
    smembers = mockRedisInstance.smembers;
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
import { CacheService } from "../cache.service";
import { AppLoggingService } from "../../../logging/services/logging.service";

describe("CacheService", () => {
  let service: CacheService;
  let mockLogger: vi.Mocked<AppLoggingService>;
  let mockConfigService: vi.Mocked<ConfigService>;

  // `queue` is the per-project namespace (REDIS_QUEUE) that BullMQ uses as its
  // key prefix; the cache keys carry it too so two stacks sharing one Redis
  // cannot read or invalidate each other's entries.
  const TEST_CONFIG = {
    redis: {
      host: "localhost",
      port: 6379,
      username: "",
      password: "",
      queue: "testapp",
    },
    cache: {
      enabled: true,
      defaultTtl: 3600,
      skipPatterns: ["/health", "/version"],
    },
  };

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    mockPipeline.sadd.mockReturnThis();
    mockPipeline.expire.mockReturnThis();
    mockPipeline.del.mockReturnThis();
    mockPipeline.srem.mockReturnThis();
    mockPipeline.exec.mockResolvedValue([]);

    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      log: vi.fn(),
      debug: vi.fn(),
    } as any;

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === "redis") return TEST_CONFIG.redis;
        if (key === "cache") return TEST_CONFIG.cache;
        return undefined;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: AppLoggingService, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // The namespace is what keeps two stacks on one Redis apart. Without it these
  // keys were global to the INSTANCE: a dev and an e2e stack of the same app
  // share seeded user ids by construction, so they would have served each other
  // cached responses and cross-deleted entries through the pattern invalidators.
  describe("key namespacing (redis.queue)", () => {
    const buildService = async (redis: Record<string, unknown>): Promise<CacheService> => {
      const configService = {
        get: vi.fn((key: string) => {
          if (key === "redis") return redis;
          if (key === "cache") return TEST_CONFIG.cache;
          return undefined;
        }),
      } as any;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CacheService,
          { provide: AppLoggingService, useValue: mockLogger },
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      return module.get<CacheService>(CacheService);
    };

    it("prefixes cache keys with the queue namespace", async () => {
      const scoped = await buildService({ ...TEST_CONFIG.redis, queue: "projecta" });
      expect(scoped.generateCacheKey("user123", "GET", "/users")).toContain("projecta:api_cache:user123:");
    });

    it("gives two stacks on the same Redis different keys for the same request", async () => {
      const dev = await buildService({ ...TEST_CONFIG.redis, queue: "avvocato360" });
      const e2e = await buildService({ ...TEST_CONFIG.redis, queue: "avvocato360e2e" });

      // Same user id, same request — the seeded e2e user ids are fixed, so this
      // is exactly the collision the namespace has to prevent.
      const devKey = dev.generateCacheKey("same-user-id", "GET", "/users");
      const e2eKey = e2e.generateCacheKey("same-user-id", "GET", "/users");

      expect(devKey).not.toBe(e2eKey);
    });

    it("falls back to the bare prefix when no queue is configured", async () => {
      const unscoped = await buildService({ host: "localhost", port: 6379, username: "", password: "" });
      expect(unscoped.generateCacheKey("user123", "GET", "/users")).toContain("api_cache:user123:");
      expect(unscoped.generateCacheKey("user123", "GET", "/users").startsWith("api_cache:")).toBe(true);
    });

    it("namespaces the element index used by invalidateByElement", async () => {
      const scoped = await buildService({ ...TEST_CONFIG.redis, queue: "projecta" });
      mockRedisInstance.smembers.mockResolvedValue([]);

      await scoped.invalidateByElement("users", "123");

      expect(mockRedisInstance.smembers).toHaveBeenCalledWith("projecta:element:users:123");
    });
  });

  describe("generateCacheKey", () => {
    it("should generate cache key with user, method, url, and hash", () => {
      const key = service.generateCacheKey("user123", "GET", "/api/users", { page: 1 }, undefined);

      expect(key).toContain("testapp:api_cache:");
      expect(key).toContain("user123");
      expect(key).toContain("GET");
      expect(key).toContain("/api/users");
    });

    it("should generate different keys for different query params", () => {
      const key1 = service.generateCacheKey("user123", "GET", "/api/users", { page: 1 }, undefined);
      const key2 = service.generateCacheKey("user123", "GET", "/api/users", { page: 2 }, undefined);

      expect(key1).not.toEqual(key2);
    });

    it("should generate same key for same params", () => {
      const key1 = service.generateCacheKey("user123", "GET", "/api/users", { page: 1 }, undefined);
      const key2 = service.generateCacheKey("user123", "GET", "/api/users", { page: 1 }, undefined);

      expect(key1).toEqual(key2);
    });
  });

  describe("get", () => {
    it("should return cached data when available", async () => {
      const cachedData = { data: { type: "users", id: "123" } };
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await service.get("test-key");

      expect(mockRedisInstance.get).toHaveBeenCalledWith("test-key");
      expect(result).toEqual(cachedData);
    });

    it("should return null when cache miss", async () => {
      mockRedisInstance.get.mockResolvedValue(null);

      const result = await service.get("test-key");

      expect(result).toBeNull();
    });

    it("should return null and log error on Redis error", async () => {
      mockRedisInstance.get.mockRejectedValue(new Error("Redis error"));

      const result = await service.get("test-key");

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("set", () => {
    it("should set cache with default TTL", async () => {
      const data = { data: { type: "users", id: "123" } };
      mockRedisInstance.setex.mockResolvedValue("OK");

      await service.set("test-key", data);

      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        "test-key",
        TEST_CONFIG.cache.defaultTtl,
        JSON.stringify(data),
      );
    });

    it("should set cache with custom TTL", async () => {
      const data = { simple: "data" };
      mockRedisInstance.setex.mockResolvedValue("OK");

      await service.set("test-key", data, 1800);

      expect(mockRedisInstance.setex).toHaveBeenCalledWith("test-key", 1800, JSON.stringify(data));
    });

    it("should track JSON:API elements when setting cache", async () => {
      const jsonApiData = {
        data: { type: "users", id: "user123", attributes: { name: "Test" } },
        included: [{ type: "roles", id: "role456", attributes: { name: "Admin" } }],
      };
      mockRedisInstance.setex.mockResolvedValue("OK");

      await service.set("test-key", jsonApiData);

      expect(mockPipeline.sadd).toHaveBeenCalled();
      expect(mockPipeline.expire).toHaveBeenCalled();
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it("should handle Redis errors gracefully", async () => {
      mockRedisInstance.setex.mockRejectedValue(new Error("Redis error"));

      await service.set("test-key", { data: "test" });

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete cache key and remove from element tracking", async () => {
      mockRedisInstance.del.mockResolvedValue(1);
      mockRedisInstance.keys.mockResolvedValue([]);

      await service.delete("test-key");

      expect(mockRedisInstance.del).toHaveBeenCalledWith("test-key");
    });

    it("should handle errors gracefully", async () => {
      mockRedisInstance.del.mockRejectedValue(new Error("Redis error"));

      await service.delete("test-key");

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("deleteUserCache", () => {
    it("should delete all cache keys for a user", async () => {
      const userKeys = ["testapp:api_cache:user123:GET:/users", "testapp:api_cache:user123:GET:/roles"];
      mockRedisInstance.keys.mockResolvedValue(userKeys);
      mockRedisInstance.del.mockResolvedValue(2);

      await service.deleteUserCache("user123");

      expect(mockRedisInstance.keys).toHaveBeenCalledWith("testapp:api_cache:user123:*");
      expect(mockRedisInstance.del).toHaveBeenCalledWith(...userKeys);
    });

    it("should not call del if no keys found", async () => {
      mockRedisInstance.keys.mockResolvedValue([]);

      await service.deleteUserCache("user123");

      expect(mockRedisInstance.del).not.toHaveBeenCalled();
    });
  });

  describe("deleteByPattern", () => {
    it("should delete keys matching pattern", async () => {
      const matchingKeys = ["key1", "key2", "key3"];
      mockRedisInstance.keys.mockResolvedValue(matchingKeys);
      mockRedisInstance.del.mockResolvedValue(3);

      await service.deleteByPattern("test:*");

      expect(mockRedisInstance.keys).toHaveBeenCalledWith("test:*");
      expect(mockRedisInstance.del).toHaveBeenCalledWith(...matchingKeys);
    });
  });

  describe("invalidateByElement", () => {
    it("should invalidate all cache keys for an element", async () => {
      const cacheKeys = ["cache1", "cache2"];
      mockRedisInstance.smembers.mockResolvedValue(cacheKeys);

      await service.invalidateByElement("users", "123");

      expect(mockRedisInstance.smembers).toHaveBeenCalledWith("testapp:element:users:123");
      expect(mockPipeline.del).toHaveBeenCalled();
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it("should not do anything if no cache keys for element", async () => {
      mockRedisInstance.smembers.mockResolvedValue([]);
      mockPipeline.exec.mockClear();

      await service.invalidateByElement("users", "123");

      expect(mockPipeline.exec).not.toHaveBeenCalled();
    });
  });

  describe("invalidateByElements", () => {
    it("should invalidate multiple elements", async () => {
      mockRedisInstance.smembers.mockResolvedValue([]);

      await service.invalidateByElements([
        { type: "users", id: "1" },
        { type: "roles", id: "2" },
      ]);

      expect(mockRedisInstance.smembers).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalidateByType", () => {
    it("should invalidate all elements of a type", async () => {
      const elementKeys = ["testapp:element:users:1", "testapp:element:users:2"];
      mockRedisInstance.keys.mockResolvedValue(elementKeys);
      mockRedisInstance.smembers.mockResolvedValue(["cache1"]);

      await service.invalidateByType("users");

      expect(mockRedisInstance.keys).toHaveBeenCalledWith("testapp:element:users:*");
    });

    it("should not do anything if no elements of type exist", async () => {
      mockRedisInstance.keys.mockResolvedValue([]);

      await service.invalidateByType("nonexistent");

      expect(mockRedisInstance.smembers).not.toHaveBeenCalled();
    });
  });

  describe("getCacheKeysForElement", () => {
    it("should return cache keys for an element", async () => {
      const cacheKeys = ["key1", "key2"];
      mockRedisInstance.smembers.mockResolvedValue(cacheKeys);

      const result = await service.getCacheKeysForElement("users", "123");

      expect(mockRedisInstance.smembers).toHaveBeenCalledWith("testapp:element:users:123");
      expect(result).toEqual(cacheKeys);
    });

    it("should return empty array on error", async () => {
      mockRedisInstance.smembers.mockRejectedValue(new Error("Redis error"));

      const result = await service.getCacheKeysForElement("users", "123");

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("getAllTrackedElements", () => {
    it("should return all tracked element keys", async () => {
      mockRedisInstance.keys.mockResolvedValue(["testapp:element:users:1", "testapp:element:roles:2"]);

      const result = await service.getAllTrackedElements();

      expect(result).toEqual(["users:1", "roles:2"]);
    });

    it("should return empty array on error", async () => {
      mockRedisInstance.keys.mockRejectedValue(new Error("Redis error"));

      const result = await service.getAllTrackedElements();

      expect(result).toEqual([]);
    });
  });

  describe("clearAll", () => {
    it("should clear all cache and element keys", async () => {
      const cacheKeys = ["testapp:api_cache:key1", "testapp:api_cache:key2"];
      const elementKeys = ["testapp:element:users:1"];
      mockRedisInstance.keys.mockResolvedValueOnce(cacheKeys).mockResolvedValueOnce(elementKeys);
      mockRedisInstance.del.mockResolvedValue(3);

      await service.clearAll();

      expect(mockRedisInstance.del).toHaveBeenCalledWith(...cacheKeys, ...elementKeys);
    });

    it("should not call del if no keys exist", async () => {
      mockRedisInstance.keys.mockResolvedValue([]);

      await service.clearAll();

      expect(mockRedisInstance.del).not.toHaveBeenCalled();
    });
  });

  describe("shouldCache", () => {
    it("should return true for GET requests when enabled", () => {
      const result = service.shouldCache("GET", "/api/users");

      expect(result).toBe(true);
    });

    it("should return false for non-GET requests", () => {
      expect(service.shouldCache("POST", "/api/users")).toBe(false);
      expect(service.shouldCache("PUT", "/api/users")).toBe(false);
      expect(service.shouldCache("DELETE", "/api/users")).toBe(false);
    });

    it("should return false for skip patterns", () => {
      expect(service.shouldCache("GET", "/health")).toBe(false);
      expect(service.shouldCache("GET", "/version")).toBe(false);
    });
  });

  describe("getRedisClient", () => {
    it("should return the Redis client instance", () => {
      const client = service.getRedisClient();

      expect(client).toBeDefined();
      expect(typeof client.get).toBe("function");
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
