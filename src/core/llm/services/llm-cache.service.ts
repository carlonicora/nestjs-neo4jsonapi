import { Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { Redis } from "ioredis";
import { BaseConfigInterface, ConfigRedisInterface } from "../../../config/interfaces";
import { ModelWeight } from "../enums/model.weight";

/**
 * Builds the cache key for an LLM response.
 *
 * GOLDEN RULE: this package is a domain-agnostic library (used by multiple
 * applications). The key is derived ONLY from generic LLM parameters — model
 * tier, sampling temperature, system prompts and the prompt itself. It MUST
 * NOT incorporate any application concept (game/round/memory/etc.); doing so
 * would both leak app semantics into the library and fragment the cache.
 *
 * `CACHE_VERSION` (default `"v1"`) is mixed in so a deployment can invalidate
 * every cached response at once by bumping the env var — useful when a prompt
 * template or model mapping changes in a way that should not serve stale hits.
 *
 * The hash is sha256 (hex) prefixed with `"llm:"` so keys are easy to scan and
 * collision-resistant across the whole keyspace.
 */
export function buildCacheKey(params: {
  modelWeight: ModelWeight;
  temperature?: number;
  systemPrompts: string[];
  prompt: string;
}): string {
  const version = process.env.CACHE_VERSION ?? "v1";
  const raw = `${version}|${params.modelWeight}|${params.temperature ?? ""}|${params.systemPrompts.join("|")}|${params.prompt}`;
  const digest = createHash("sha256").update(raw).digest("hex");
  return `llm:${digest}`;
}

/**
 * Redis-backed cache for LLM responses.
 *
 * Failure-tolerant by design: Redis is an optimisation, never a dependency of
 * the primary request path. Any Redis error on read is treated as a miss
 * (pass-through to the provider); any Redis error on write is swallowed. A
 * cache outage therefore degrades to "no cache", never to a failed LLM call.
 *
 * Follows the package's Redis convention (mirrors `RedisLockService` /
 * `CacheService`): the client is constructed in-service from `ConfigService`
 * using `ioredis`. The optional `clientOverride` constructor argument exists
 * purely as a unit-test seam — Nest's DI never supplies it, so production
 * always builds a real client.
 */
@Injectable()
export class LLMCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(LLMCacheService.name);
  private readonly redis: Redis;

  constructor(configService: ConfigService<BaseConfigInterface>, @Optional() clientOverride?: Redis) {
    if (clientOverride) {
      this.redis = clientOverride;
      return;
    }
    const redisConfig = configService.get<ConfigRedisInterface>("redis");
    this.redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      username: redisConfig.username,
      password: redisConfig.password,
      lazyConnect: true,
    });
  }

  /**
   * Reads a cached value. A miss, or ANY Redis error, returns `null` so the
   * caller proceeds to invoke the provider normally.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      if (cached === null || cached === undefined) return null;
      return JSON.parse(cached) as T;
    } catch (error) {
      this.logger.warn(`LLM cache get failed for key ${key} — treating as miss: ${String(error)}`);
      return null;
    }
  }

  /**
   * Write-through of a value with a TTL (default 24h). Any Redis error is
   * swallowed — a failed write must never break the LLM call that produced the
   * value.
   */
  async set<T>(key: string, value: T, ttlSeconds: number = 24 * 60 * 60): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (error) {
      this.logger.warn(`LLM cache set failed for key ${key} — skipping write: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
