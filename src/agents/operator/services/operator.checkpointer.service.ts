import { BaseCheckpointSaver, MemorySaver } from "@langchain/langgraph";
import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigOperatorInterface } from "../../../config/interfaces/config.operator.interface";
import { ConfigRedisInterface } from "../../../config/interfaces/config.redis.interface";

/** Default number of days an operator approval may stay pending. */
export const OPERATOR_DEFAULT_APPROVAL_TTL_DAYS = 7;

/**
 * Commands RedisSaver depends on that only exist when the RedisJSON and
 * RediSearch modules are loaded (redis-stack / Redis 8+ where they are core).
 */
const OPERATOR_REQUIRED_REDIS_COMMANDS = ["JSON.SET", "FT.CREATE"] as const;

/**
 * OperatorCheckpointerService - Durable checkpoint storage for the operator agent.
 *
 * Lazily constructs and caches a LangGraph checkpoint saver:
 * - `RedisSaver` (from `@langchain/langgraph-checkpoint-redis`) when a Redis
 *   connection is configured, using the same `redis` config block the
 *   QueueModule reads from ConfigService.
 * - `MemorySaver` fallback when no Redis config is present (tests).
 *
 * Checkpoints expire after `(operator.approvalTtlDays ?? 7) + 1` days, one day
 * past the approval expiry so a pending approval never outlives its checkpoint.
 */
@Injectable()
export class OperatorCheckpointerService implements OnModuleDestroy {
  private readonly logger = new Logger(OperatorCheckpointerService.name);

  private saverPromise?: Promise<BaseCheckpointSaver>;

  constructor(private readonly configService: ConfigService<BaseConfigInterface>) {}

  /** Lazily constructs and caches the saver; MemorySaver fallback when redis config is absent (tests). */
  async getSaver(): Promise<BaseCheckpointSaver> {
    if (!this.saverPromise) {
      this.saverPromise = this.createSaver();
      // A rejected saver (e.g. Redis briefly down) must not be cached forever:
      // clear the cache so the next getSaver() call retries the connection.
      // Callers awaiting the current promise still observe the rejection.
      this.saverPromise.catch(() => (this.saverPromise = undefined));
    }

    return this.saverPromise;
  }

  /** Closes the Redis connection on shutdown; never throws. */
  async onModuleDestroy(): Promise<void> {
    if (!this.saverPromise) {
      return;
    }

    try {
      const saver = (await this.saverPromise) as BaseCheckpointSaver & { end?: () => Promise<void> };
      if (typeof saver.end === "function") {
        await saver.end();
      }
    } catch (error) {
      this.logger.warn(`Failed to close operator checkpointer on shutdown: ${error}`);
    }
  }

  private async createSaver(): Promise<BaseCheckpointSaver> {
    const redis = this.configService.get<ConfigRedisInterface>("redis");
    if (!redis?.host) {
      this.logger.warn(
        "Operator checkpointer falling back to MemorySaver — checkpoints will not survive restarts. Configure redis.host for durable checkpoints.",
      );
      return new MemorySaver();
    }

    const url = this.buildRedisUrl(redis);

    // RedisSaver.fromUrl SUCCEEDS against a Redis without RedisJSON/RediSearch
    // (its ensureIndexes only logs the FT.CREATE failure); the first checkpoint
    // write then dies on JSON.SET and the rejection crashes the process. Probe
    // the server BEFORE adopting RedisSaver so plain Redis degrades gracefully.
    const missingCommands = await this.probeMissingRedisCommands(url);
    if (missingCommands.length > 0) {
      this.logger.error(
        `Operator checkpointer: Redis at ${redis.host}:${redis.port} lacks the RedisJSON/RediSearch modules required for durable checkpoints (missing commands: ${missingCommands.join(", ")}; Redis 8+ or redis-stack needed). Falling back to MemorySaver — pending approvals will NOT survive restarts.`,
      );
      return new MemorySaver();
    }

    const operator = this.configService.get<ConfigOperatorInterface>("operator");
    const approvalTtlDays = operator?.approvalTtlDays ?? OPERATOR_DEFAULT_APPROVAL_TTL_DAYS;

    // RedisSaver's `defaultTTL` option is expressed in MINUTES (the saver
    // multiplies by 60 internally), so (approvalTtlDays + 1) days in seconds
    // equals (approvalTtlDays + 1) * 24 * 60 minutes here.
    const defaultTTL = (approvalTtlDays + 1) * 24 * 60;

    const saver = await RedisSaver.fromUrl(url, { defaultTTL });
    this.attachSaverErrorHandler(saver);
    return saver;
  }

  /**
   * Probes the Redis server for the module commands RedisSaver depends on,
   * using a short-lived ioredis client (already a dependency of this package —
   * the node-redis `redis` package used by the saver is not resolvable from
   * here under pnpm's strict isolation).
   *
   * `COMMAND INFO <name>` replies with a single-element array whose element is
   * nil (`[null]`) when the command is unknown, and a populated array when it
   * exists. It is preferred over `MODULE LIST` because on Redis 8+ the JSON
   * and search commands are built into core (no module entry), while
   * COMMAND INFO reports them uniformly on redis-stack, module-loaded Redis,
   * and Redis 8+.
   *
   * Connection failures reject and propagate to the caller, exactly like a
   * `RedisSaver.fromUrl` failure: getSaver() clears the cached promise so the
   * next call retries.
   */
  private async probeMissingRedisCommands(url: string): Promise<string[]> {
    const probe = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    // ioredis clients emit "error" events; without a listener an emitted error
    // crashes the process. Connection failures are still surfaced through the
    // rejected connect()/call() promises — the listener only absorbs the
    // duplicate event emission.
    probe.on("error", () => undefined);

    try {
      await probe.connect();

      const missing: string[] = [];
      for (const command of OPERATOR_REQUIRED_REDIS_COMMANDS) {
        const reply = await probe.call("COMMAND", "INFO", command);
        const supported = Array.isArray(reply) && reply.length > 0 && reply[0] !== null && reply[0] !== undefined;
        if (!supported) {
          missing.push(command);
        }
      }

      return missing;
    } finally {
      // disconnect() closes immediately and never throws (quit() can hang or
      // reject on an already-broken connection).
      probe.disconnect();
    }
  }

  /**
   * RedisSaver.fromUrl creates its node-redis client without an "error"
   * listener, so a socket error after startup would crash the process. The
   * client is a TypeScript-private but runtime-reachable field; attach a
   * logging handler when it is reachable, and degrade silently when a future
   * library version hides it.
   */
  private attachSaverErrorHandler(saver: RedisSaver): void {
    const client = (
      saver as unknown as { client?: { on?: (event: string, listener: (error: unknown) => void) => unknown } }
    ).client;

    if (client && typeof client.on === "function") {
      client.on("error", (error) => this.logger.error(`Operator checkpointer Redis client error: ${error}`));
    } else {
      this.logger.warn(
        "Operator checkpointer: could not attach an error handler to the RedisSaver client (internal client not reachable).",
      );
    }
  }

  private buildRedisUrl(redis: ConfigRedisInterface): string {
    const credentials =
      redis.username || redis.password
        ? `${encodeURIComponent(redis.username ?? "")}:${encodeURIComponent(redis.password ?? "")}@`
        : "";

    // IPv6 hosts must be bracketed to form a valid URL (e.g. redis://[::1]:6379).
    const host = redis.host.includes(":") ? `[${redis.host}]` : redis.host;

    return `redis://${credentials}${host}:${redis.port}`;
  }
}
