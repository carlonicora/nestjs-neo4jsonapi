import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { BaseConfigInterface, ConfigRedisInterface } from "../../../config/interfaces";

@Injectable()
export class RedisLockService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisLockService.name);
  private redis: Redis;

  constructor(configService: ConfigService<BaseConfigInterface>) {
    const redisConfig = configService.get<ConfigRedisInterface>("redis");
    this.redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      username: redisConfig.username,
      password: redisConfig.password,
      lazyConnect: true,
    });
  }

  async tryAcquire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  async release(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async withLock<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | null> {
    if (!(await this.tryAcquire(key, ttlSeconds))) {
      this.logger.log(`Lock ${key} held; skipping.`);
      return null;
    }
    try {
      return await fn();
    } finally {
      await this.release(key);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
