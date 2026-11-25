import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { BaseConfigInterface, ConfigRedisInterface } from "../../../config/interfaces";

/** Start-up locks: first retry delay after a Redis error, doubled on each further error. */
export const REDIS_RETRY_BASE_MS = 1000;
/** Start-up locks: longest delay between two retries after Redis errors. */
export const REDIS_RETRY_MAX_DELAY_MS = 30_000;
/** Start-up locks: Redis errors in a row before it gives up (1+2+4+8+16 s, then 30 s each: about 10 minutes). */
export const REDIS_RETRY_MAX_ATTEMPTS = 25;

/** Deletes `KEYS[1]` only while its value is still `ARGV[1]` (the owner's token); returns 1 when deleted. */
const RELEASE_IF_OWNER_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Resets `KEYS[1]`'s lifetime to `ARGV[2]` milliseconds only while its value is still `ARGV[1]`
 * (the owner's token); returns 1 when renewed, 0 when the key is gone or held by someone else.
 */
const RENEW_IF_OWNER_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;

@Injectable()
export class RedisLockService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisLockService.name);
  private redis: Redis;
  private readonly queue: string;

  constructor(configService: ConfigService<BaseConfigInterface>) {
    const redisConfig = configService.get<ConfigRedisInterface>("redis");
    this.queue = redisConfig.queue ?? "";
    this.redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      username: redisConfig.username,
      password: redisConfig.password,
      lazyConnect: true,
    });
  }

  /** A lock key scoped to this app's queue prefix: `<queue>:lock:<name>`, or `lock:<name>` with no queue. */
  scopedKey(name: string): string {
    return this.queue ? `${this.queue}:lock:${name}` : `lock:${name}`;
  }

  /** True while the key exists (held and not expired). */
  async isHeld(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) === 1;
  }

  /** Takes the key if it is free (`SET NX EX`), expiring after `ttlSeconds` whole seconds. True when taken. */
  async tryAcquire(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.setIfFree(key, "EX", ttlSeconds)) !== null;
  }

  /**
   * {@link tryAcquire} that returns the owner's token instead of true, or null when the key is
   * held. Pass the token to {@link release} so only this owner's lock is deleted.
   */
  async tryAcquireOwned(key: string, ttlSeconds: number): Promise<string | null> {
    return this.setIfFree(key, "EX", ttlSeconds);
  }

  /**
   * {@link tryAcquire} with the lifetime in milliseconds (`SET NX PX`), for locks that must
   * expire within a second, such as a cron ticking every second.
   */
  async tryAcquireMs(key: string, ttlMs: number): Promise<boolean> {
    return (await this.setIfFree(key, "PX", ttlMs)) !== null;
  }

  /**
   * `SET key <token> <unit> ttl NX` with a fresh random token as the value. Returns the token
   * when taken, null when held. The branch only satisfies ioredis's per-unit overloads.
   */
  private async setIfFree(key: string, unit: "EX" | "PX", ttl: number): Promise<string | null> {
    const token = randomUUID();
    const result =
      unit === "EX"
        ? await this.redis.set(key, token, "EX", ttl, "NX")
        : await this.redis.set(key, token, "PX", ttl, "NX");
    return result === "OK" ? token : null;
  }

  /**
   * Frees the key.
   *
   * - With `token` (from {@link tryAcquireOwned}): deletes the key only while its value is still
   *   that token, in one atomic step. A lock that expired and was taken by another process is
   *   left in place, and a warning is logged.
   * - Without `token`: deletes the key unconditionally, whoever holds it. Kept for callers that
   *   pair it with {@link tryAcquire}.
   */
  async release(key: string, token?: string): Promise<void> {
    if (token === undefined) {
      await this.redis.del(key);
      return;
    }
    const deleted = await this.redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, key, token);
    if (Number(deleted) !== 1) {
      this.logger.warn(`Lock ${key} expired before release and is no longer ours; left in place.`);
    }
  }

  /**
   * Runs `fn` holding the key and releases it afterwards, also when `fn` throws.
   * A held key skips the run and returns null. While `fn` runs, the key's TTL is renewed every
   * third of the TTL (see {@link startRenewal}), so a run longer than the TTL keeps the lock.
   * The release deletes the key only while this run still owns it: when the lock was lost
   * anyway and another process took the key, that lock stays.
   *
   * By default a Redis error throws, as fits a request. With `retryOnRedisError` (start-up
   * hooks only) a Redis error while taking the key is retried as described in
   * {@link acquireRetrying}, and a Redis error on release is logged only.
   */
  async withLock<T>(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
    options?: { retryOnRedisError?: boolean },
  ): Promise<T | null> {
    const retry = options?.retryOnRedisError === true;
    const token = retry ? await this.acquireRetrying(key, ttlSeconds) : await this.tryAcquireOwned(key, ttlSeconds);
    if (token === null) {
      this.logger.log(`Lock ${key} held; skipping.`);
      return null;
    }
    const stopRenewal = this.startRenewal(key, token, ttlSeconds);
    try {
      return await fn();
    } finally {
      stopRenewal();
      if (retry) await this.releaseQuietly(key, token, ttlSeconds);
      else await this.release(key, token);
    }
  }

  /**
   * Waits until the key is free, then runs `fn` holding it and releases it afterwards,
   * also when `fn` throws. Unlike {@link withLock}, a held key never skips the run.
   * As in {@link withLock}, the key's TTL is renewed while `fn` runs.
   * Meant for start-up hooks: a Redis error while taking the key is retried as described
   * in {@link acquireRetrying}, and a Redis error on release is logged only. As in
   * {@link withLock}, the release never deletes a lock another process took after the TTL ran out.
   */
  async withLockWaiting<T>(key: string, ttlSeconds: number, fn: () => Promise<T>, pollMs = 1000): Promise<T> {
    let loggedHeld = false;
    let token: string | null;
    while ((token = await this.acquireRetrying(key, ttlSeconds)) === null) {
      if (!loggedHeld) {
        this.logger.log(`Lock ${key} held; waiting.`);
        loggedHeld = true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    }
    const stopRenewal = this.startRenewal(key, token, ttlSeconds);
    try {
      return await fn();
    } finally {
      stopRenewal();
      await this.releaseQuietly(key, token, ttlSeconds);
    }
  }

  /**
   * {@link tryAcquireOwned}, retrying on a Redis error instead of throwing: the delay starts at
   * 1s and doubles up to 30s, so a worker started before Redis is ready comes up once Redis
   * answers. After {@link REDIS_RETRY_MAX_ATTEMPTS} errors in a row (about 10 minutes) it
   * throws, and the guarded work does not run.
   */
  private async acquireRetrying(key: string, ttlSeconds: number): Promise<string | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        const acquired = await this.tryAcquireOwned(key, ttlSeconds);
        if (attempt > 1)
          this.logger.log(`Redis reachable again for lock ${key} after ${attempt - 1} failed attempt(s).`);
        return acquired;
      } catch (error) {
        const message = (error as Error)?.message ?? String(error);
        if (attempt >= REDIS_RETRY_MAX_ATTEMPTS) {
          throw new Error(
            `Redis unreachable while taking lock ${key}: ${attempt} attempts failed, last error: ${message}. ` +
              `The guarded work did not run.`,
          );
        }
        const delayMs = Math.min(REDIS_RETRY_BASE_MS * 2 ** (attempt - 1), REDIS_RETRY_MAX_DELAY_MS);
        this.logger.warn(
          `Redis error while taking lock ${key} (attempt ${attempt}/${REDIS_RETRY_MAX_ATTEMPTS}): ${message}; ` +
            `retrying in ${delayMs / 1000}s.`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Keeps an owned lock alive while its guarded work runs: every `ttlSeconds / 3` it resets the
   * key's lifetime to the full TTL, in one atomic step that checks the value is still `token`.
   * Returns the function that stops renewing; call it as soon as the work settles.
   *
   * - The key no longer ours (expired, or taken by another process): logs an error and stops
   *   renewing. The work is not interrupted.
   * - A Redis error: logged as a warning; the next renewal is tried on schedule.
   */
  private startRenewal(key: string, token: string, ttlSeconds: number): () => void {
    const ttlMs = ttlSeconds * 1000;
    const intervalMs = Math.max(1, Math.floor(ttlMs / 3));
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (): void => {
      timer = setTimeout(() => void renew(), intervalMs);
      timer.unref?.();
    };

    const renew = async (): Promise<void> => {
      if (stopped) return;
      try {
        const renewed = await this.redis.eval(RENEW_IF_OWNER_SCRIPT, 1, key, token, String(ttlMs));
        if (stopped) return;
        if (Number(renewed) !== 1) {
          this.logger.error(
            `Lock ${key} was lost while its work was still running (expired or taken by another process); ` +
              `renewal stopped, the work goes on unguarded.`,
          );
          return;
        }
      } catch (error) {
        if (stopped) return;
        this.logger.warn(
          `Redis error while renewing lock ${key}: ${(error as Error)?.message ?? String(error)}; retrying in ${intervalMs}ms.`,
        );
      }
      schedule();
    };

    schedule();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }

  /** {@link release}, logging a Redis error instead of throwing: the key expires with its TTL. */
  private async releaseQuietly(key: string, token: string, ttlSeconds: number): Promise<void> {
    try {
      await this.release(key, token);
    } catch (error) {
      this.logger.warn(
        `Redis error while releasing lock ${key}: ${(error as Error)?.message ?? String(error)}; it expires in ${ttlSeconds}s.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
