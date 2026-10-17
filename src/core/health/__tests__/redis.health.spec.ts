import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HealthCheckError } from "@nestjs/terminus";
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

    it("should throw HealthCheckError when not connected", async () => {
      redisService.isConnected.mockReturnValue(false);

      try {
        await indicator.isHealthy("redis");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect((error as HealthCheckError).causes).toEqual({
          redis: {
            status: "down",
            message: "Redis client not connected",
          },
        });
      }
    });

    it("should throw HealthCheckError when ping fails", async () => {
      redisService.isConnected.mockReturnValue(true);
      mockRedisClient.ping.mockRejectedValue(new Error("Connection lost"));

      try {
        await indicator.isHealthy("redis");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect((error as HealthCheckError).causes).toEqual({
          redis: {
            status: "down",
            message: "Connection lost",
          },
        });
      }
    });

    it("should throw HealthCheckError when ping returns unexpected response", async () => {
      redisService.isConnected.mockReturnValue(true);
      mockRedisClient.ping.mockResolvedValue("UNEXPECTED");

      try {
        await indicator.isHealthy("redis");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect((error as HealthCheckError).causes).toEqual({
          redis: {
            status: "down",
            message: "Unexpected PING response: UNEXPECTED",
          },
        });
      }
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
        const assertion = expect(indicator.isHealthy("redis")).rejects.toThrow(HealthCheckError);
        await vi.advanceTimersByTimeAsync(3000);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
