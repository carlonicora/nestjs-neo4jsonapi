import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HealthIndicatorService } from "@nestjs/terminus";
import { RedisHealthIndicator } from "../indicators/redis.health";
import { RedisClientStorageService } from "../../redis/services/redis.client.storage.service";

describe("RedisHealthIndicator", () => {
  let indicator: RedisHealthIndicator;
  let redisService: Mocked<RedisClientStorageService>;

  const mockRedisClient = {
    ping: vi.fn(),
  };

  beforeEach(async () => {
    const mockRedisService = {
      isConnected: vi.fn(),
      getRedisClient: vi.fn().mockReturnValue(mockRedisClient),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        { provide: HealthIndicatorService, useValue: new HealthIndicatorService() },
        {
          provide: RedisClientStorageService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    indicator = module.get<RedisHealthIndicator>(RedisHealthIndicator);
    redisService = module.get(RedisClientStorageService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("isHealthy", () => {
    it("should return healthy status when Redis is connected and responds to ping", async () => {
      redisService.isConnected.mockReturnValue(true);
      mockRedisClient.ping.mockResolvedValue("PONG");

      const result = await indicator.isHealthy("redis");

      expect(redisService.isConnected).toHaveBeenCalled();
      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(result).toEqual({
        redis: {
          status: "up",
          message: "Redis connection healthy",
        },
      });
    });

    it("should return down status when not connected", async () => {
      redisService.isConnected.mockReturnValue(false);

      const result = await indicator.isHealthy("redis");

      expect(result).toEqual({
        redis: {
          status: "down",
          message: "Redis client not connected",
        },
      });
    });

    it("should return down status when ping fails", async () => {
      redisService.isConnected.mockReturnValue(true);
      mockRedisClient.ping.mockRejectedValue(new Error("Connection lost"));

      const result = await indicator.isHealthy("redis");

      expect(result).toEqual({
        redis: {
          status: "down",
          message: "Connection lost",
        },
      });
    });

    it("should return down status when ping returns unexpected response", async () => {
      redisService.isConnected.mockReturnValue(true);
      mockRedisClient.ping.mockResolvedValue("UNEXPECTED");

      const result = await indicator.isHealthy("redis");

      expect(result).toEqual({
        redis: {
          status: "down",
          message: "Unexpected PING response: UNEXPECTED",
        },
      });
    });

    it("should handle timeout", async () => {
      redisService.isConnected.mockReturnValue(true);
      mockRedisClient.ping.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 5000);
          }),
      );

      // Fake clock: the indicator's 3s race timeout fires without waiting it out.
      vi.useFakeTimers();
      try {
        const resultPromise = indicator.isHealthy("redis");
        await vi.advanceTimersByTimeAsync(3000);
        const result = await resultPromise;

        expect(result).toEqual({
          redis: {
            status: "down",
            message: "Health check timeout",
          },
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
