import { Injectable } from "@nestjs/common";
import { HealthIndicatorResult, HealthIndicatorService } from "@nestjs/terminus";
import { RedisClientStorageService } from "../../redis/services/redis.client.storage.service";

@Injectable()
export class RedisHealthIndicator {
  private readonly TIMEOUT_MS = 3000;

  constructor(
    private readonly redisService: RedisClientStorageService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      // Check if Redis client is connected
      const isConnected = this.redisService.isConnected();

      if (!isConnected) {
        throw new Error("Redis client not connected");
      }

      // Execute PING command to verify responsiveness
      const redis = this.redisService.getRedisClient();

      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Health check timeout")), this.TIMEOUT_MS);
      });

      // Execute PING
      const pingPromise = redis.ping();

      // Race between ping and timeout
      const result = await Promise.race([pingPromise, timeoutPromise]);

      if (result !== "PONG") {
        throw new Error(`Unexpected PING response: ${result}`);
      }

      return indicator.up({
        message: "Redis connection healthy",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return indicator.down({
        message: errorMessage,
      });
    }
  }
}
