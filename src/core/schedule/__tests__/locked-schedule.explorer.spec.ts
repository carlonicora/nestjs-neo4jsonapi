import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, SchedulerRegistry } from "@nestjs/schedule";
import { Test, TestingModule } from "@nestjs/testing";
import { CronTime } from "cron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedisLockService } from "../../redis/services/redis.lock.service";
import { cronLockTtlMs, cronTimeFor, nearestCronTickMs, shortestCronGapMs } from "../locked-schedule.explorer";
import { createLockedScheduleModule } from "../locked-schedule.module";

@Injectable()
class Sample {
  runs = 0;

  @Cron("*/5 * * * *", { name: "named-task" })
  named() {
    this.runs++;
  }

  @Cron("*/5 * * * *")
  unnamed() {
    this.runs++;
  }

  @Cron("0 * * * *", { name: "hourly-task" })
  hourly() {
    this.runs++;
  }

  @Cron("*/10 * * * * *", { name: "ten-seconds-task" })
  tenSeconds() {
    this.runs++;
  }

  @Cron("* * * * * *", { name: "every-second-task" })
  everySecond() {
    this.runs++;
  }
}

type FakeLock = { tryAcquireMs: ReturnType<typeof vi.fn> };

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

// A TestingModule is a Nest application context; createNestApplication() would need an HTTP platform package.
const apps: TestingModule[] = [];

const buildApp = async (lock: FakeLock): Promise<{ app: TestingModule; sample: Sample }> => {
  @Global()
  @Module({
    providers: [
      { provide: RedisLockService, useValue: lock },
      { provide: ConfigService, useValue: { get: (key: string) => (key === "redis" ? { queue: "q" } : undefined) } },
    ],
    exports: [RedisLockService, ConfigService],
  })
  class FakeInfraModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [FakeInfraModule, createLockedScheduleModule()],
    providers: [Sample],
  }).compile();
  const app = await moduleRef.init();
  apps.push(app);
  return { app, sample: app.get(Sample) };
};

const fire = async (app: TestingModule, name: string): Promise<void> => {
  const job = app.get(SchedulerRegistry).getCronJobs().get(name);
  if (!job) throw new Error(`no cron job ${name}`);
  await job.fireOnTick();
  await flush();
};

const NAMED_JOBS = ["named-task", "hourly-task", "ten-seconds-task", "every-second-task"];

const unnamedJobName = (app: TestingModule): string => {
  const names = [...app.get(SchedulerRegistry).getCronJobs().keys()].filter((name) => !NAMED_JOBS.includes(name));
  expect(names).toHaveLength(1);
  return names[0];
};

const at = (iso: string): number => Date.parse(iso);

/** Pins the clock the explorer reads for the tick; cron timers stay real (jobs are fired by hand). */
const setNow = (iso: string): void => {
  vi.setSystemTime(new Date(iso));
};

describe("LockedScheduleExplorer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-07T12:00:00Z"), toFake: ["Date"] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    while (apps.length) await apps.pop()!.close();
  });

  it("runs a named task once when the lock is granted, keyed on the task and its tick, with a 300 000 ms TTL (every 5 minutes)", async () => {
    const lock = { tryAcquireMs: vi.fn().mockResolvedValue(true) };
    const { app, sample } = await buildApp(lock);

    setNow("2026-03-07T12:05:00.020Z");
    await fire(app, "named-task");

    expect(sample.runs).toBe(1);
    expect(lock.tryAcquireMs).toHaveBeenCalledWith(`q:cron-lock:named-task:${at("2026-03-07T12:05:00Z")}`, 300_000);
  });

  it("gives an hourly task the 300 000 ms cap", async () => {
    const lock = { tryAcquireMs: vi.fn().mockResolvedValue(true) };
    const { app } = await buildApp(lock);

    setNow("2026-03-07T13:00:00.050Z");
    await fire(app, "hourly-task");

    expect(lock.tryAcquireMs).toHaveBeenCalledWith(`q:cron-lock:hourly-task:${at("2026-03-07T13:00:00Z")}`, 300_000);
  });

  it("gives an every-10-seconds task the 60 000 ms floor", async () => {
    const lock = { tryAcquireMs: vi.fn().mockResolvedValue(true) };
    const { app } = await buildApp(lock);

    setNow("2026-03-07T12:00:10Z");
    await fire(app, "ten-seconds-task");

    expect(lock.tryAcquireMs).toHaveBeenCalledWith(
      `q:cron-lock:ten-seconds-task:${at("2026-03-07T12:00:10Z")}`,
      60_000,
    );
  });

  it("works out the TTL once at registration, not on every tick", async () => {
    const lock = { tryAcquireMs: vi.fn().mockResolvedValue(true) };
    const { app } = await buildApp(lock);
    const sendAt = vi.spyOn(CronTime.prototype, "sendAt");

    setNow("2026-03-07T12:00:10Z");
    await fire(app, "ten-seconds-task");
    setNow("2026-03-07T12:00:20Z");
    await fire(app, "ten-seconds-task");

    expect(sendAt).not.toHaveBeenCalled();
    expect(lock.tryAcquireMs).toHaveBeenNthCalledWith(
      2,
      `q:cron-lock:ten-seconds-task:${at("2026-03-07T12:00:20Z")}`,
      60_000,
    );
  });

  describe("two workers sharing one Redis", () => {
    const sharedLock = () => {
      const held = new Set<string>();
      return { tryAcquireMs: vi.fn(async (key: string) => (held.has(key) ? false : (held.add(key), true))) };
    };

    it("runs a 10-second tick once when the second worker fires it 4 s late", async () => {
      const lock = sharedLock();
      const first = await buildApp(lock);
      const second = await buildApp(lock);

      setNow("2026-03-07T12:00:10Z");
      await fire(first.app, "ten-seconds-task");
      setNow("2026-03-07T12:00:14Z");
      await fire(second.app, "ten-seconds-task");

      expect(first.sample.runs + second.sample.runs).toBe(1);
      expect(lock.tryAcquireMs.mock.calls[0][0]).toBe(lock.tryAcquireMs.mock.calls[1][0]);
    });

    it("runs a 10-second tick once when the second worker's clock is 4 s behind", async () => {
      const lock = sharedLock();
      const first = await buildApp(lock);
      const second = await buildApp(lock);

      setNow("2026-03-07T12:00:10Z");
      await fire(first.app, "ten-seconds-task");
      setNow("2026-03-07T12:00:06Z");
      await fire(second.app, "ten-seconds-task");

      expect(first.sample.runs + second.sample.runs).toBe(1);
    });

    it("runs two different ticks once each, even while the first tick's lock is still alive", async () => {
      const lock = sharedLock();
      const first = await buildApp(lock);
      const second = await buildApp(lock);

      setNow("2026-03-07T12:00:10Z");
      await fire(first.app, "ten-seconds-task");
      setNow("2026-03-07T12:00:20.004Z");
      await fire(second.app, "ten-seconds-task");

      expect(first.sample.runs).toBe(1);
      expect(second.sample.runs).toBe(1);
      expect(lock.tryAcquireMs.mock.calls.map(([key]) => key)).toEqual([
        `q:cron-lock:ten-seconds-task:${at("2026-03-07T12:00:10Z")}`,
        `q:cron-lock:ten-seconds-task:${at("2026-03-07T12:00:20Z")}`,
      ]);
    });

    it("runs an every-second tick on exactly one of two workers", async () => {
      const lock = sharedLock();
      const first = await buildApp(lock);
      const second = await buildApp(lock);

      setNow("2026-03-07T12:00:01.010Z");
      await fire(first.app, "every-second-task");
      setNow("2026-03-07T12:00:01.300Z");
      await fire(second.app, "every-second-task");

      expect(first.sample.runs + second.sample.runs).toBe(1);
      expect(lock.tryAcquireMs).toHaveBeenCalledWith(
        `q:cron-lock:every-second-task:${at("2026-03-07T12:00:01Z")}`,
        60_000,
      );
    });
  });

  it("keys an unnamed task by class and method name", async () => {
    const lock = { tryAcquireMs: vi.fn().mockResolvedValue(true) };
    const { app, sample } = await buildApp(lock);

    setNow("2026-03-07T12:05:00Z");
    await fire(app, unnamedJobName(app));

    expect(lock.tryAcquireMs).toHaveBeenCalledWith(`q:cron-lock:Sample.unnamed:${at("2026-03-07T12:05:00Z")}`, 300_000);
    expect(sample.runs).toBe(1);
  });

  it("does not run the method when the lock is refused", async () => {
    const lock = { tryAcquireMs: vi.fn().mockResolvedValue(false) };
    const { app, sample } = await buildApp(lock);

    await fire(app, "named-task");

    expect(sample.runs).toBe(0);
  });

  it("logs an error and skips the run when the lock call rejects", async () => {
    const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const lock = { tryAcquireMs: vi.fn().mockRejectedValue(new Error("redis down")) };
    const { app, sample } = await buildApp(lock);

    await expect(fire(app, "named-task")).resolves.toBeUndefined();

    expect(sample.runs).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not ask for the lock on a direct call", async () => {
    const lock = { tryAcquireMs: vi.fn().mockResolvedValue(true) };
    const { sample } = await buildApp(lock);

    sample.named();

    expect(sample.runs).toBe(1);
    expect(lock.tryAcquireMs).not.toHaveBeenCalled();
  });

  it("registers every job, keeping the cron metadata on the wrapper", async () => {
    const lock = { tryAcquireMs: vi.fn().mockResolvedValue(true) };
    const { app } = await buildApp(lock);

    const jobs = app.get(SchedulerRegistry).getCronJobs();

    expect(jobs.has("named-task")).toBe(true);
    expect(jobs.size).toBe(5);
  });
});

describe("nearest cron tick", () => {
  const tick = (cronTime: string, nowIso: string, zone?: { timeZone?: string; utcOffset?: number }) =>
    nearestCronTickMs(cronTimeFor({ cronTime, ...zone })!, at(nowIso));

  it("is the tick itself when fired on time", () => {
    expect(tick("*/10 * * * * *", "2026-03-07T12:00:10Z")).toBe(at("2026-03-07T12:00:10Z"));
  });

  it("is the same tick up to just under half a gap early or late", () => {
    expect(tick("*/10 * * * * *", "2026-03-07T12:00:14.999Z")).toBe(at("2026-03-07T12:00:10Z"));
    expect(tick("*/10 * * * * *", "2026-03-07T12:00:05.001Z")).toBe(at("2026-03-07T12:00:10Z"));
  });

  it("takes the earlier tick on an exact half-gap tie", () => {
    expect(tick("*/10 * * * * *", "2026-03-07T12:00:15Z")).toBe(at("2026-03-07T12:00:10Z"));
  });

  it("finds the previous tick of an irregular schedule", () => {
    // Ticks at :00 and :20 of every minute: 12:00:22 belongs to :20, 12:00:45 to the next minute.
    expect(tick("0,20 * * * * *", "2026-03-07T12:00:22Z")).toBe(at("2026-03-07T12:00:20Z"));
    expect(tick("0,20 * * * * *", "2026-03-07T12:00:45Z")).toBe(at("2026-03-07T12:01:00Z"));
  });

  it("follows the time zone across a DST change", () => {
    vi.useFakeTimers({ now: new Date("2026-03-07T12:00:00Z"), toFake: ["Date"] });
    try {
      // New York skips 02:00-03:00 on 8 March 2026: the hourly ticks are 06:00Z (01:00 EST) then 07:00Z (03:00 EDT).
      expect(tick("0 0 * * * *", "2026-03-08T06:00:03Z", { timeZone: "America/New_York" })).toBe(
        at("2026-03-08T06:00:00Z"),
      );
      expect(tick("0 0 * * * *", "2026-03-08T06:59:57Z", { timeZone: "America/New_York" })).toBe(
        at("2026-03-08T07:00:00Z"),
      );
      // The skipped 02:30 tick fires at 03:00 EDT (07:00Z); the next day it is back at 02:30 EDT (06:30Z).
      expect(tick("30 2 * * *", "2026-03-08T07:00:04Z", { timeZone: "America/New_York" })).toBe(
        at("2026-03-08T07:00:00Z"),
      );
      expect(tick("30 2 * * *", "2026-03-09T06:29:58Z", { timeZone: "America/New_York" })).toBe(
        at("2026-03-09T06:30:00Z"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a UTC offset schedule in that offset", () => {
    // 09:00 at UTC+02:00 is 07:00Z.
    expect(tick("0 0 9 * * *", "2026-03-07T07:00:02Z", { utcOffset: 120 })).toBe(at("2026-03-07T07:00:00Z"));
  });
});

describe("cron lock TTL", () => {
  const ttl = (cronTime: string, timeZone?: string) => cronLockTtlMs(shortestCronGapMs({ cronTime, timeZone }));

  it("is the gap for every 5 minutes, capped at 300 000 ms for hourly", () => {
    expect(shortestCronGapMs({ cronTime: "*/5 * * * *" })).toBe(5 * 60_000);
    expect(ttl("*/5 * * * *")).toBe(300_000);
    expect(shortestCronGapMs({ cronTime: "0 * * * *" })).toBe(60 * 60_000);
    expect(ttl("0 * * * *")).toBe(300_000);
    expect(ttl("*/2 * * * *")).toBe(120_000);
  });

  it("floors second-level schedules at 60 000 ms", () => {
    expect(shortestCronGapMs({ cronTime: "*/10 * * * * *" })).toBe(10_000);
    expect(ttl("*/10 * * * * *")).toBe(60_000);
    expect(shortestCronGapMs({ cronTime: "* * * * * *" })).toBe(1_000);
    expect(ttl("* * * * * *")).toBe(60_000);
  });

  it("uses the shortest gap of an irregular schedule", () => {
    expect(shortestCronGapMs({ cronTime: "0 0 0,1 * * *" })).toBe(60 * 60_000);
    expect(shortestCronGapMs({ cronTime: "0,20 * * * * *" })).toBe(20_000);
  });

  it("reads the gap in the task's time zone, across a DST change", () => {
    vi.useFakeTimers({ now: new Date("2026-03-07T12:00:00Z"), toFake: ["Date"] });
    try {
      // 02:30 New York is skipped on 8 March 2026, so that day's tick lands an hour off.
      const daily = shortestCronGapMs({ cronTime: "30 2 * * *", timeZone: "America/New_York" });
      expect(daily).toBeLessThanOrEqual(24 * 60 * 60_000);
      expect(daily).toBeGreaterThanOrEqual(23 * 60 * 60_000);
      expect(ttl("*/15 * * * * *", "Europe/Rome")).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the cap when there is no measurable gap", () => {
    expect(shortestCronGapMs({ cronTime: "not a cron" })).toBeUndefined();
    expect(cronLockTtlMs(undefined)).toBe(300_000);
  });
});
