import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HealthCheckService, HealthCheckResult } from "@nestjs/terminus";
import { HealthController } from "../controllers/health.controller";
import { Neo4jHealthIndicator } from "../indicators/neo4j.health";
import { RedisHealthIndicator } from "../indicators/redis.health";
import { S3HealthIndicator } from "../indicators/s3.health";
import { DiskHealthIndicator } from "../indicators/disk.health";

describe("HealthController", () => {
  let controller: HealthController;
  let healthCheckService: Mocked<HealthCheckService>;
  let neo4jHealth: Mocked<Neo4jHealthIndicator>;
  let redisHealth: Mocked<RedisHealthIndicator>;
  let s3Health: Mocked<S3HealthIndicator>;
  let diskHealth: Mocked<DiskHealthIndicator>;

  const mockHealthCheckResult: HealthCheckResult = {
    status: "ok",
    info: {
      neo4j: { status: "up" },
      redis: { status: "up" },
    },
    error: {},
    details: {
      neo4j: { status: "up" },
      redis: { status: "up" },
    },
  };

  beforeEach(async () => {
    const mockHealthCheckService = {
      check: vi.fn(),
    };

    const mockNeo4jHealth = {
      isHealthy: vi.fn(),
    };

    const mockRedisHealth = {
      isHealthy: vi.fn(),
    };

    const mockS3Health = {
      isHealthy: vi.fn(),
    };

    const mockDiskHealth = {
      isHealthy: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: Neo4jHealthIndicator, useValue: mockNeo4jHealth },
        { provide: RedisHealthIndicator, useValue: mockRedisHealth },
        { provide: S3HealthIndicator, useValue: mockS3Health },
        { provide: DiskHealthIndicator, useValue: mockDiskHealth },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get(HealthCheckService);
    neo4jHealth = module.get(Neo4jHealthIndicator);
    redisHealth = module.get(RedisHealthIndicator);
    s3Health = module.get(S3HealthIndicator);
    diskHealth = module.get(DiskHealthIndicator);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("check (full health)", () => {
    it("should call health check with all indicators", async () => {
      healthCheckService.check.mockResolvedValue(mockHealthCheckResult);

      const result = await controller.check();

      expect(healthCheckService.check).toHaveBeenCalled();
      expect(result).toEqual(mockHealthCheckResult);

      // Verify all 4 indicators are passed to check
      const checkArgs = healthCheckService.check.mock.calls[0][0];
      expect(checkArgs).toHaveLength(4);
    });

    it("should return 200 when all dependencies healthy", async () => {
      healthCheckService.check.mockResolvedValue({
        status: "ok",
        info: {
          neo4j: { status: "up" },
          redis: { status: "up" },
          storage: { status: "up" },
          disk: { status: "up" },
        },
        error: {},
        details: {},
      });

      const result = await controller.check();

      expect(result.status).toBe("ok");
    });
  });

  describe("liveness", () => {
    it("should call health check with empty indicators array", async () => {
      healthCheckService.check.mockResolvedValue({
        status: "ok",
        info: {},
        error: {},
        details: {},
      });

      const result = await controller.liveness();

      expect(healthCheckService.check).toHaveBeenCalledWith([]);
      expect(result.status).toBe("ok");
    });
  });

  describe("readiness", () => {
    it("should call health check with only Neo4j and Redis indicators", async () => {
      healthCheckService.check.mockResolvedValue({
        status: "ok",
        info: {
          neo4j: { status: "up" },
          redis: { status: "up" },
        },
        error: {},
        details: {},
      });

      const result = await controller.readiness();

      expect(healthCheckService.check).toHaveBeenCalled();
      expect(result.status).toBe("ok");

      // Verify only 2 indicators are passed (Neo4j and Redis)
      const checkArgs = healthCheckService.check.mock.calls[0][0];
      expect(checkArgs).toHaveLength(2);
    });

    it("should return error status when Neo4j is unavailable", async () => {
      healthCheckService.check.mockResolvedValue({
        status: "error",
        info: {
          redis: { status: "up" },
        },
        error: {
          neo4j: { status: "down", message: "Connection refused" },
        },
        details: {},
      });

      const result = await controller.readiness();

      expect(result.status).toBe("error");
    });

    it("should return error status when Redis is unavailable", async () => {
      healthCheckService.check.mockResolvedValue({
        status: "error",
        info: {
          neo4j: { status: "up" },
        },
        error: {
          redis: { status: "down", message: "Not connected" },
        },
        details: {},
      });

      const result = await controller.readiness();

      expect(result.status).toBe("error");
    });
  });
});
