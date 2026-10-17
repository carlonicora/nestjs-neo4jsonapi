import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { HealthCheckError } from "@nestjs/terminus";
import { Neo4jHealthIndicator } from "../indicators/neo4j.health";
import { Neo4jService } from "../../neo4j/services/neo4j.service";

describe("Neo4jHealthIndicator", () => {
  let indicator: Neo4jHealthIndicator;
  let neo4jService: Mocked<Neo4jService>;

  beforeEach(async () => {
    const mockNeo4jService = {
      read: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Neo4jHealthIndicator,
        {
          provide: Neo4jService,
          useValue: mockNeo4jService,
        },
      ],
    }).compile();

    indicator = module.get<Neo4jHealthIndicator>(Neo4jHealthIndicator);
    neo4jService = module.get(Neo4jService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("isHealthy", () => {
    it("should return healthy status when query succeeds", async () => {
      neo4jService.read.mockResolvedValue({ records: [{ result: 1 }] });

      const result = await indicator.isHealthy("neo4j");

      expect(neo4jService.read).toHaveBeenCalledWith("RETURN 1 as result", {});
      expect(result).toEqual({
        neo4j: {
          status: "up",
          message: "Neo4j connection healthy",
        },
      });
    });

    it("should throw HealthCheckError when query fails", async () => {
      neo4jService.read.mockRejectedValue(new Error("Connection refused"));

      await expect(indicator.isHealthy("neo4j")).rejects.toThrow(HealthCheckError);
    });

    it("should include error message in unhealthy status", async () => {
      neo4jService.read.mockRejectedValue(new Error("Database unavailable"));

      try {
        await indicator.isHealthy("neo4j");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect((error as HealthCheckError).causes).toEqual({
          neo4j: {
            status: "down",
            message: "Database unavailable",
          },
        });
      }
    });

    it("should handle timeout", async () => {
      // Create a promise that never resolves
      neo4jService.read.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 5000);
          }),
      );

      // Fake clock: the indicator's 3s race timeout fires without waiting it out.
      vi.useFakeTimers();
      try {
        const assertion = expect(indicator.isHealthy("neo4j")).rejects.toThrow(HealthCheckError);
        await vi.advanceTimersByTimeAsync(3000);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });

    it("should handle non-Error exceptions", async () => {
      neo4jService.read.mockRejectedValue("String error");

      try {
        await indicator.isHealthy("neo4j");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect((error as HealthCheckError).causes).toEqual({
          neo4j: {
            status: "down",
            message: "Unknown error",
          },
        });
      }
    });
  });
});
