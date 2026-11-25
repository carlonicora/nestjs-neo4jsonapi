import { Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ScheduleExplorer } from "@nestjs/schedule";
import { CronTime } from "cron";
import { ConfigRedisInterface } from "../../config/interfaces/config.redis.interface";
import { RedisLockService } from "../redis/services/redis.lock.service";

/**
 * Metadata key `@Cron` stores its options under. Copied from
 * `@nestjs/schedule/dist/schedule.constants.js`: the package's `exports` map does not expose that file.
 */
const SCHEDULE_CRON_OPTIONS = "SCHEDULE_CRON_OPTIONS";

/**
 * Longest a cron lock lives, in milliseconds. The lock is never released and is keyed on its tick,
 * so its lifetime only has to outlast the moment the last worker fires that tick.
 */
export const CRON_LOCK_MAX_TTL_MS = 5 * 60_000;

/** Shortest a cron lock lives, in milliseconds: covers clock skew and a slow start between workers. */
export const CRON_LOCK_MIN_TTL_MS = 60_000;

/** Upcoming ticks sampled to find a schedule's shortest gap (covers irregular lists like `0 0,1 * * *`). */
const CRON_GAP_SAMPLE_TICKS = 50;

/** Most ticks walked while looking for the last tick at or before now (bounds a pathological schedule). */
const CRON_TICK_WALK_LIMIT = 1_000;

type CronScheduleOptions = { cronTime: unknown; timeZone?: string; utcOffset?: number };

/**
 * The task's schedule as a `CronTime`, built the way `@nestjs/schedule` builds its `CronJob`
 * (time zone, or UTC offset). Undefined when it cannot be parsed; `@nestjs/schedule` reports a
 * bad expression itself when it mounts the job.
 */
export const cronTimeFor = (options: CronScheduleOptions): CronTime | undefined => {
  try {
    const CronTimeCtor = CronTime as unknown as new (
      source: unknown,
      timeZone?: string | null,
      utcOffset?: number | null,
    ) => CronTime;
    return options.timeZone
      ? new CronTimeCtor(options.cronTime, options.timeZone, null)
      : new CronTimeCtor(options.cronTime, null, options.utcOffset ?? null);
  } catch {
    return undefined;
  }
};

/**
 * Shortest gap between two consecutive ticks of a cron schedule, in milliseconds, read from the
 * next {@link CRON_GAP_SAMPLE_TICKS} dates in the schedule's time zone (or UTC offset).
 * Returns `undefined` when the schedule has fewer than two upcoming ticks (a one-shot date) or
 * cannot be parsed.
 */
export const shortestCronGapMs = (options: CronScheduleOptions): number | undefined => {
  const time = cronTimeFor(options);
  if (!time) return undefined;

  let dates: { toMillis(): number }[];
  try {
    const next = time.sendAt(CRON_GAP_SAMPLE_TICKS);
    dates = Array.isArray(next) ? next : [next];
  } catch {
    return undefined;
  }

  let shortest: number | undefined;
  for (let i = 1; i < dates.length; i++) {
    const gap = dates[i].toMillis() - dates[i - 1].toMillis();
    if (gap > 0 && (shortest === undefined || gap < shortest)) shortest = gap;
  }
  return shortest;
};

/** The zone `CronTime.sendAt` reads the schedule in: its time zone, or its UTC offset as `UTC±hh:mm`. */
const cronZone = (time: CronTime): string | undefined => {
  if (time.timeZone) return time.timeZone;
  if (time.utcOffset === undefined) return undefined;
  const sign = time.utcOffset < 0 ? "-" : "+";
  const hours = Math.trunc(time.utcOffset / 60);
  const minutes = Math.abs(time.utcOffset - hours * 60);
  return `UTC${sign}${String(Math.abs(hours)).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

/** First tick strictly after `fromMs`, in epoch milliseconds. */
const nextTickAfterMs = (time: CronTime, fromMs: number): number =>
  time.getNextDateFrom(new Date(fromMs), cronZone(time)).toMillis();

/**
 * The scheduled tick an invocation at `nowMs` belongs to, in epoch milliseconds: of the last tick
 * at or before now and the first one after it, the one closer to now (the earlier on a tie). Read
 * in the schedule's own time zone, so a DST change moves the ticks the same way `CronJob` does.
 *
 * Workers firing the same tick a little early or late (clock skew, a busy event loop) all land on
 * it as long as they are less than half a gap away from it. A one-shot date is its own tick.
 */
export const nearestCronTickMs = (time: CronTime, nowMs: number): number => {
  if (time.realDate) return (time.source as { toMillis(): number }).toMillis();

  const next = nextTickAfterMs(time, nowMs);
  // A previous tick farther back than `next` cannot be the nearer one: only that window is searched.
  let previous: number | undefined;
  let candidate = nextTickAfterMs(time, nowMs - (next - nowMs) - 1);
  for (let i = 0; candidate <= nowMs && i < CRON_TICK_WALK_LIMIT; i++) {
    previous = candidate;
    candidate = nextTickAfterMs(time, candidate);
  }

  if (previous === undefined) return next;
  return nowMs - previous <= next - nowMs ? previous : next;
};

/**
 * Lock lifetime for a schedule, in milliseconds: its shortest tick gap, floored at
 * {@link CRON_LOCK_MIN_TTL_MS} and capped at {@link CRON_LOCK_MAX_TTL_MS}. A schedule with no
 * measurable gap gets the cap.
 *
 * The key carries the tick (see {@link nearestCronTickMs}), so the next tick takes a different key
 * and a lock longer than the gap never skips a tick: the lifetime no longer has to stay under the
 * gap. It only has to outlast the latest worker to fire the same tick, so at least a minute covers
 * clock skew and a slow start with room to spare. The cap bounds what stays in Redis: an
 * every-second cron keeps about 60 small keys alive at once, an hourly one a single key for 5 minutes.
 */
export const cronLockTtlMs = (gapMs: number | undefined): number => {
  if (gapMs === undefined) return CRON_LOCK_MAX_TTL_MS;
  return Math.min(CRON_LOCK_MAX_TTL_MS, Math.max(CRON_LOCK_MIN_TTL_MS, gapMs));
};

/**
 * `ScheduleExplorer` that wraps every `@Cron` method in a Redis lock, so of several workers
 * firing the same tick only the one that takes the lock runs it.
 *
 * The lock key is `<queue>:cron-lock:<task>:<tickEpochMs>`, where the tick is the scheduled fire
 * time this invocation belongs to (see {@link nearestCronTickMs}): workers firing the same tick up
 * to half a gap early or late build the same key, and each tick has its own. The lock is never
 * released; it expires on its own after {@link cronLockTtlMs}, worked out once per task at
 * registration. The schedule is parsed once at registration too.
 *
 * Inherits the parent's constructor injection; its own dependencies are property injections,
 * named so they do not clash with the parent's private fields.
 */
export class LockedScheduleExplorer extends ScheduleExplorer {
  @Inject(RedisLockService) private readonly cronLock: RedisLockService;
  @Inject(ConfigService) private readonly cronConfig: ConfigService;
  private readonly cronLogger = new Logger("CronLock");

  lookupSchedulers(instance: Record<string, (...args: unknown[]) => unknown>, key: string): void {
    const original = instance[key];
    const options = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, original);
    if (!options) return super.lookupSchedulers(instance, key);

    const task: string = options.name ?? `${instance.constructor.name}.${key}`;
    const ttlMs = cronLockTtlMs(shortestCronGapMs(options));
    const time = cronTimeFor(options);

    const locked = async (...args: unknown[]): Promise<void> => {
      const queue = this.cronConfig.get<ConfigRedisInterface>("redis")?.queue;
      let lockKey = queue ? `${queue}:cron-lock:${task}` : `cron-lock:${task}`;

      let acquired: boolean;
      try {
        // An unparseable schedule never mounts (`@nestjs/schedule` throws), so the fallback to the
        // nearest second is only a guard.
        const tick = time ? nearestCronTickMs(time, Date.now()) : Math.round(Date.now() / 1000) * 1000;
        lockKey = `${lockKey}:${tick}`;
        acquired = await this.cronLock.tryAcquireMs(lockKey, ttlMs);
      } catch (error) {
        this.cronLogger.error(`[${task}] could not take the cron lock ${lockKey}: ${(error as Error)?.message}`);
        return;
      }
      if (!acquired) return;

      await original.call(instance, ...args);
    };

    for (const metaKey of Reflect.getMetadataKeys(original)) {
      Reflect.defineMetadata(metaKey, Reflect.getMetadata(metaKey, original), locked);
    }

    const proxy = Object.create(instance);
    proxy[key] = locked;
    super.lookupSchedulers(proxy, key);
  }
}
