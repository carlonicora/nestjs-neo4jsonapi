import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HealthIndicatorService } from "@nestjs/terminus";
import { DiskHealthIndicator } from "../indicators/disk.health";

describe("DiskHealthIndicator", () => {
  let indicator: DiskHealthIndicator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DiskHealthIndicator, { provide: HealthIndicatorService, useValue: new HealthIndicatorService() }],
    }).compile();

    indicator = module.get<DiskHealthIndicator>(DiskHealthIndicator);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("isHealthy", () => {
    it("should return healthy status when disk has enough space", async () => {
      const result = await indicator.isHealthy("disk");

      expect(result).toHaveProperty("disk");
      expect(result.disk.status).toBe("up");
      expect(result.disk.message).toBe("Disk space healthy");
      expect(result.disk.total).toBeDefined();
      expect(result.disk.free).toBeDefined();
      expect(result.disk.used).toBeDefined();
      expect(result.disk.usedPercentage).toBeDefined();
    });

    it("should include disk statistics in response", async () => {
      const result = await indicator.isHealthy("disk");

      // Verify the format of the response
      expect(result.disk.total).toMatch(/^\d+\.\d{2} (B|KB|MB|GB|TB)$/);
      expect(result.disk.free).toMatch(/^\d+\.\d{2} (B|KB|MB|GB|TB)$/);
      expect(result.disk.used).toMatch(/^\d+\.\d{2} (B|KB|MB|GB|TB)$/);
      expect(result.disk.usedPercentage).toMatch(/^\d+\.\d%$/);
    });
  });
});
