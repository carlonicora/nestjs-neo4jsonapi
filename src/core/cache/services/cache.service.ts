import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { BaseConfigInterface, ConfigCacheInterface, ConfigRedisInterface } from "../../../config/interfaces";
import { AppLoggingService } from "../../logging/services/logging.service";

interface JsonApiResource {
  type: string;
  id: string;
  attributes?: any;
  relationships?: any;
}

interface JsonApiResponse {
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  meta?: any;
  links?: any;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private redis: Redis;
  private readonly CACHE_KEY_PREFIX = "api_cache:";
  private readonly ELEMENT_KEY_PREFIX = "element:";

  constructor(
    private readonly logger: AppLoggingService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    const redisConfig = this.configService.get<ConfigRedisInterface>("redis");
    this.redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      username: redisConfig.username,
      password: redisConfig.password,
    });
  }

  private get cacheConfig(): ConfigCacheInterface {
    return this.configService.get<ConfigCacheInterface>("cache");
  }

  generateCacheKey(userId: string, method: string, url: string, query?: any, body?: any): string {
    const baseKey = `${this.CACHE_KEY_PREFIX}${userId}:${method}:${url}`;

    const paramsHash = this.hashObject({ query, body });
    return `${baseKey}:${paramsHash}`;
  }

  async get(cacheKey: string): Promise<any | null> {
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      this.logger.error(`Error getting cache for key ${cacheKey}:`, error);
      return null;
    }
  }

  async set(cacheKey: string, data: any, ttl: number = this.cacheConfig.defaultTtl): Promise<void> {
    try {
      await this.redis.setex(cacheKey, ttl, JSON.stringify(data));

      await this.trackJsonApiElements(cacheKey, data, ttl);
    } catch (error) {
      this.logger.error(`Error setting cache for key ${cacheKey}:`, error);
    }
  }

  private async trackJsonApiElements(cacheKey: string, data: any, ttl: number): Promise<void> {
    if (!this.isJsonApiResponse(data)) {
      return;
    }

    const elements = this.extractJsonApiElements(data as JsonApiResponse);
    const pipeline = this.redis.pipeline();

    for (const element of elements) {
      const elementKey = `${this.ELEMENT_KEY_PREFIX}${element.type}:${element.id}`;

      pipeline.sadd(elementKey, cacheKey);

      pipeline.expire(elementKey, ttl + 300);
    }

    await pipeline.exec();
  }

  private isJsonApiResponse(data: any): boolean {
    return (
      data &&
      typeof data === "object" &&
      data.data !== undefined &&
      (Array.isArray(data.data) || (typeof data.data === "object" && data.data.type && data.data.id))
    );
  }

  private extractJsonApiElements(response: JsonApiResponse): JsonApiResource[] {
    const elements: JsonApiResource[] = [];

    if (Array.isArray(response.data)) {
      elements.push(...response.data);
    } else if (response.data && response.data.type && response.data.id) {
      elements.push(response.data);
    }

    if (response.included && Array.isArray(response.included)) {
      elements.push(...response.included);
    }

    return elements.filter((element) => element.type && element.id);
  }

  async delete(cacheKey: string): Promise<void> {
    try {
      await this.redis.del(cacheKey);

      await this.removeFromElementTracking(cacheKey);
    } catch (error) {
      this.logger.error(`Error deleting cache for key ${cacheKey}:`, error);
    }
  }

  async deleteUserCache(userId: string): Promise<void> {
    try {
      const pattern = `${this.CACHE_KEY_PREFIX}${userId}:*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.error(`Error deleting user cache for ${userId}:`, error);
    }
  }

  async deleteByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.error(`Error deleting cache by pattern ${pattern}:`, error);
    }
  }

  async invalidateByElement(type: string, id: string): Promise<void> {
    try {
      const elementKey = `${this.ELEMENT_KEY_PREFIX}${type}:${id}`;

      const cacheKeys = await this.redis.smembers(elementKey);

      if (cacheKeys.length === 0) {
        return;
      }

      const pipeline = this.redis.pipeline();

      for (const cacheKey of cacheKeys) {
        pipeline.del(cacheKey);
      }

      pipeline.del(elementKey);

      await pipeline.exec();
    } catch (error) {
      this.logger.error(`Error invalidating cache for element ${type}:${id}:`, error);
    }
  }

  async invalidateByElements(elements: Array<{ type: string; id: string }>): Promise<void> {
    const promises = elements.map((element) => this.invalidateByElement(element.type, element.id));
    await Promise.all(promises);
  }

  async invalidateByType(type: string): Promise<void> {
    try {
      const elementKeys = await this.redis.keys(`${this.ELEMENT_KEY_PREFIX}${type}:*`);

      if (elementKeys.length === 0) {
        return;
      }

      const allCacheKeys = new Set<string>();

      for (const elementKey of elementKeys) {
        const cacheKeys = await this.redis.smembers(elementKey);
        cacheKeys.forEach((key) => allCacheKeys.add(key));
      }

      if (allCacheKeys.size === 0) {
        return;
      }

      const pipeline = this.redis.pipeline();

      for (const cacheKey of allCacheKeys) {
        pipeline.del(cacheKey);
      }

      for (const elementKey of elementKeys) {
        pipeline.del(elementKey);
      }

      await pipeline.exec();
    } catch (error) {
      this.logger.error(`Error invalidating cache for type ${type}:`, error);
    }
  }

  private async removeFromElementTracking(cacheKey: string): Promise<void> {
    try {
      const elementKeys = await this.redis.keys(`${this.ELEMENT_KEY_PREFIX}*`);

      const pipeline = this.redis.pipeline();
      for (const elementKey of elementKeys) {
        pipeline.srem(elementKey, cacheKey);
      }

      await pipeline.exec();
    } catch (error) {
      this.logger.error(`Error removing cache key ${cacheKey} from element tracking:`, error);
    }
  }

  async getCacheKeysForElement(type: string, id: string): Promise<string[]> {
    try {
      const elementKey = `${this.ELEMENT_KEY_PREFIX}${type}:${id}`;
      return await this.redis.smembers(elementKey);
    } catch (error) {
      this.logger.error(`Error getting cache keys for element ${type}:${id}:`, error);
      return [];
    }
  }

  async getAllTrackedElements(): Promise<string[]> {
    try {
      const elementKeys = await this.redis.keys(`${this.ELEMENT_KEY_PREFIX}*`);
      return elementKeys.map((key) => key.replace(this.ELEMENT_KEY_PREFIX, ""));
    } catch (error) {
      this.logger.error(`Error getting all tracked elements:`, error);
      return [];
    }
  }

  async clearAll(): Promise<void> {
    try {
      const cacheKeys = await this.redis.keys(`${this.CACHE_KEY_PREFIX}*`);

      const elementKeys = await this.redis.keys(`${this.ELEMENT_KEY_PREFIX}*`);

      const allKeys = [...cacheKeys, ...elementKeys];

      if (allKeys.length > 0) {
        await this.redis.del(...allKeys);
      }
    } catch (error) {
      this.logger.error(`Error clearing all cache:`, error);
    }
  }

  shouldCache(method: string, url: string): boolean {
    if (!this.cacheConfig.enabled) {
      return false;
    }

    if (method !== "GET") {
      return false;
    }

    const shouldSkip = this.cacheConfig.skipPatterns?.some((pattern) => url.includes(pattern));
    if (shouldSkip) {
      return false;
    }

    return true;
  }

  private hashObject(obj: any): string {
    if (!obj || Object.keys(obj).length === 0) {
      return "empty";
    }

    const sortObjectKeys = (o: unknown): unknown => {
      if (o === null || typeof o !== "object") return o;
      if (Array.isArray(o)) return o.map(sortObjectKeys);
      return Object.keys(o as Record<string, unknown>)
        .sort()
        .reduce((result: Record<string, unknown>, key) => {
          result[key] = sortObjectKeys((o as Record<string, unknown>)[key]);
          return result;
        }, {});
    };

    const str = JSON.stringify(sortObjectKeys(obj));
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  getRedisClient(): Redis {
    return this.redis;
  }

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch (error) {
      console.error("Error closing Redis connection:", error);
      this.redis.disconnect();
    }
  }
}
