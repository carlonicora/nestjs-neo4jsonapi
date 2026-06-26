import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Redis } from "ioredis";
import { BaseConfigInterface, ConfigAiInterface, ConfigRedisInterface } from "../../../config/interfaces";
import { AppLoggingService } from "../../logging/services/logging.service";
import { RedisClientStorageService } from "../../redis/services/redis.client.storage.service";

// KEYS[1] = bucket key; ARGV[1] = n; ARGV[2] = capacity; ARGV[3] = refillPerMs; ARGV[4] = nowMs.
// Returns {grantedFlag, waitMs, bucketAfter}.
const CONSUME_LUA = `
local data = redis.call("HMGET", KEYS[1], "tokens", "lastRefillMs")
local capacity = tonumber(ARGV[2])
local refillPerMs = tonumber(ARGV[3])
local nowMs = tonumber(ARGV[4])
local need = tonumber(ARGV[1])
local tokens = tonumber(data[1])
if tokens == nil then tokens = capacity end
local lastRefillMs = tonumber(data[2])
if lastRefillMs == nil then lastRefillMs = nowMs end
local elapsed = math.max(0, nowMs - lastRefillMs)
tokens = math.min(capacity, tokens + elapsed * refillPerMs)
if tokens >= need then
  tokens = tokens - need
  redis.call("HMSET", KEYS[1], "tokens", tokens, "lastRefillMs", nowMs)
  redis.call("EXPIRE", KEYS[1], 300)
  return {1, 0, tostring(tokens)}
else
  local waitMs = math.ceil((need - tokens) / refillPerMs)
  redis.call("HMSET", KEYS[1], "tokens", tokens, "lastRefillMs", nowMs)
  redis.call("EXPIRE", KEYS[1], 300)
  return {0, waitMs, tostring(tokens)}
end
`;

// KEYS[1] = bucket key; ARGV[1] = tokens to add back; ARGV[2] = capacity.
const REFUND_LUA = `
local capacity = tonumber(ARGV[2])
local current = tonumber(redis.call("HGET", KEYS[1], "tokens"))
if current == nil then current = capacity end
local capped = math.min(capacity, current + tonumber(ARGV[1]))
redis.call("HSET", KEYS[1], "tokens", capped)
redis.call("EXPIRE", KEYS[1], 300)
return tostring(capped)
`;

type BucketRedis = Redis & {
  embedderBucketConsume: (
    key: string,
    n: number,
    capacity: number,
    refillPerMs: number,
    nowMs: number,
  ) => Promise<[number, number, string]>;
  embedderBucketRefund: (key: string, n: number, capacity: number) => Promise<string>;
};

/**
 * Distributed (Redis-backed) token bucket that rate-limits embedder calls across
 * every worker sharing this package's LLM layer. Only initialises when the
 * `ai.embedder.rateLimit` config block is present — without it the service is a
 * no-op (and ModelService.getEmbedder() returns the raw provider embedder).
 */
@Injectable()
export class EmbedderTokenBucketService implements OnModuleInit {
  private redis?: BucketRedis;
  private bucketKey!: string;
  private capacity!: number;
  private refillPerMs!: number;

  constructor(
    private readonly redisClientStorage: RedisClientStorageService,
    private readonly config: ConfigService<BaseConfigInterface>,
    private readonly logger: AppLoggingService,
  ) {}

  async onModuleInit(): Promise<void> {
    const ai = this.config.get<ConfigAiInterface>("ai");
    const rl = ai.embedder.rateLimit;
    // No rate-limit config → leave the bucket uninitialised. getEmbedder() will
    // not wrap the embedder when rateLimit is absent, so consume/refund are never
    // reached; this guard simply keeps onModuleInit safe in that configuration.
    if (!rl) return;

    const redisCfg = this.config.get<ConfigRedisInterface>("redis");

    this.capacity = rl.tpmLimit - rl.safetyTokens;
    this.refillPerMs = this.capacity / 60_000;
    this.bucketKey = `${redisCfg.queue}:${rl.bucketKey}`;

    this.redis = this.redisClientStorage.getRedisClient() as BucketRedis;
    this.redis.defineCommand("embedderBucketConsume", { numberOfKeys: 1, lua: CONSUME_LUA });
    this.redis.defineCommand("embedderBucketRefund", { numberOfKeys: 1, lua: REFUND_LUA });
  }

  async consume(
    estTokens: number,
    maxWaitMs: number,
  ): Promise<{ granted: boolean; waitMs: number; bucketAfter: number }> {
    if (!this.redis) throw new Error("EmbedderTokenBucketService.consume called without ai.embedder.rateLimit config");
    const start = Date.now();
    while (true) {
      const nowMs = Date.now();
      const [grantedFlag, waitMs, bucketAfterStr] = await this.redis.embedderBucketConsume(
        this.bucketKey,
        estTokens,
        this.capacity,
        this.refillPerMs,
        nowMs,
      );
      const bucketAfter = parseFloat(bucketAfterStr);

      if (grantedFlag === 1) {
        this.logger.debug("embedder.consume", undefined, {
          requestedTokens: estTokens,
          waitMs: 0,
          bucketAfter,
        });
        return { granted: true, waitMs: 0, bucketAfter };
      }

      const elapsedMs = Date.now() - start;
      const remaining = maxWaitMs - elapsedMs;
      if (waitMs > remaining) {
        this.logger.warn("embedder.bucket_starved", undefined, {
          requestedTokens: estTokens,
          waitMsExceeded: waitMs,
        });
        return { granted: false, waitMs, bucketAfter };
      }

      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  async refund(estTokens: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.embedderBucketRefund(this.bucketKey, estTokens, this.capacity);
    } catch (err) {
      this.logger.error("embedder.refund_failed", err as Error, "EmbedderTokenBucket");
    }
  }
}
