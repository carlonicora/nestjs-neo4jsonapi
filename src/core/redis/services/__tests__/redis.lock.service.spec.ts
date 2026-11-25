import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { REDIS_RETRY_MAX_ATTEMPTS, RedisLockService } from "../redis.lock.service";

// Minimal mock of ioredis behavior for SET ... NX EX / NX PX semantics.
class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();
  async set(key: string, value: string, unit: "EX" | "PX", ttl: number, _nx: "NX") {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > now) return null;
    this.store.set(key, { value, expiresAt: now + (unit === "PX" ? ttl : ttl * 1000) });
    return "OK";
  }
  async del(key: string) {
    this.store.delete(key);
    return 1;
  }
  async eval(script: string, _numKeys: number, key: string, token: string, ttlMs?: string) {
    // Mirrors the owner-checked Lua scripts: act only while the live value is the token.
    const existing = this.store.get(key);
    if (!existing || existing.expiresAt <= Date.now() || existing.value !== token) return 0;
    if (script.includes("pexpire")) {
      existing.expiresAt = Date.now() + Number(ttlMs);
      return 1;
    }
    this.store.delete(key);
    return 1;
  }
  async exists(key: string) {
    const existing = this.store.get(key);
    return existing && existing.expiresAt > Date.now() ? 1 : 0;
  }
  async quit() {
    /* no-op */
  }
}

function makeService(queue = "q") {
  const svc = new RedisLockService({
    get: () => ({ host: "localhost", port: 6379, username: undefined, password: undefined, queue }),
  } as any);
  // Replace the real Redis client with our fake.
  (svc as any).redis = new FakeRedis();
  return svc;
}

describe("RedisLockService", () => {
  it("tryAcquire returns true on first call, false on second call with same key", async () => {
    const svc = makeService();
    expect(await svc.tryAcquire("k", 60)).toBe(true);
    expect(await svc.tryAcquire("k", 60)).toBe(false);
  });

  it("tryAcquire sends SET NX EX with the TTL in seconds", async () => {
    const svc = makeService();
    const set = vi.spyOn((svc as any).redis, "set");
    await svc.tryAcquire("k", 60);
    expect(set).toHaveBeenCalledWith("k", expect.any(String), "EX", 60, "NX");
  });

  it("tryAcquireMs sends SET NX PX with the TTL in milliseconds", async () => {
    const svc = makeService();
    const set = vi.spyOn((svc as any).redis, "set");
    expect(await svc.tryAcquireMs("k", 500)).toBe(true);
    expect(set).toHaveBeenCalledWith("k", expect.any(String), "PX", 500, "NX");
  });

  it("tryAcquireMs refuses a held key and frees it once its milliseconds have passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const svc = makeService();
      expect(await svc.tryAcquireMs("k", 500)).toBe(true);
      vi.advanceTimersByTime(499);
      expect(await svc.tryAcquireMs("k", 500)).toBe(false);
      vi.advanceTimersByTime(1);
      expect(await svc.tryAcquireMs("k", 500)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tryAcquire returns true again after release", async () => {
    const svc = makeService();
    await svc.tryAcquire("k", 60);
    await svc.release("k");
    expect(await svc.tryAcquire("k", 60)).toBe(true);
  });

  it("withLock runs the fn and releases on success", async () => {
    const svc = makeService();
    const result = await svc.withLock("k", 60, async () => 42);
    expect(result).toBe(42);
    expect(await svc.tryAcquire("k", 60)).toBe(true); // lock released
  });

  it("withLock releases even when fn throws", async () => {
    const svc = makeService();
    await expect(
      svc.withLock("k", 60, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await svc.tryAcquire("k", 60)).toBe(true);
  });

  it("withLock returns null when lock is already held", async () => {
    const svc = makeService();
    await svc.tryAcquire("k", 60);
    const result = await svc.withLock("k", 60, async () => 42);
    expect(result).toBeNull();
  });

  it("scopedKey prefixes the queue, or nothing when the queue is empty", () => {
    expect(makeService().scopedKey("startup:x")).toBe("q:lock:startup:x");
    expect(makeService("").scopedKey("startup:x")).toBe("lock:startup:x");
  });

  it("isHeld follows tryAcquire and release", async () => {
    const svc = makeService();
    expect(await svc.isHeld("k")).toBe(false);
    await svc.tryAcquire("k", 60);
    expect(await svc.isHeld("k")).toBe(true);
    await svc.release("k");
    expect(await svc.isHeld("k")).toBe(false);
  });

  describe("owner token", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("tryAcquire and tryAcquireMs store a fresh token per acquisition, not a constant", async () => {
      const svc = makeService();
      const set = vi.spyOn((svc as any).redis, "set");
      await svc.tryAcquire("a", 60);
      await svc.tryAcquireMs("b", 500);
      const [first, second] = set.mock.calls.map((call) => call[1]);
      expect(first).not.toBe("1");
      expect(first).not.toBe(second);
    });

    it("tryAcquireOwned returns the token stored as the value, or null when held", async () => {
      const svc = makeService();
      const set = vi.spyOn((svc as any).redis, "set");
      const token = await svc.tryAcquireOwned("k", 60);
      expect(token).toBe(set.mock.calls[0][1]);
      expect(await svc.tryAcquireOwned("k", 60)).toBeNull();
    });

    it("release with the owner's token frees the key", async () => {
      const svc = makeService();
      const token = await svc.tryAcquireOwned("k", 60);
      await svc.release("k", token!);
      expect(await svc.isHeld("k")).toBe(false);
    });

    it("release with a stale token leaves a lock re-taken by another owner after expiry", async () => {
      const svc = makeService();
      const first = await svc.tryAcquireOwned("k", 60);
      vi.advanceTimersByTime(60_000);
      const second = await svc.tryAcquireOwned("k", 60);
      expect(second).not.toBeNull();
      const warn = vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);

      await svc.release("k", first!);

      expect(await svc.isHeld("k")).toBe(true);
      expect(warn.mock.calls[0][0]).toContain("Lock k expired before release");
      await svc.release("k", second!);
      expect(await svc.isHeld("k")).toBe(false);
    });

    it("release without a token stays unconditional", async () => {
      const svc = makeService();
      await svc.tryAcquireOwned("k", 60);
      await svc.release("k");
      expect(await svc.isHeld("k")).toBe(false);
    });

    it("withLock outliving its TTL does not delete the lock another owner took", async () => {
      const svc = makeService();
      const result = await svc.withLock("k", 60, async () => {
        vi.advanceTimersByTime(60_000);
        expect(await svc.tryAcquire("k", 60)).toBe(true);
        return 42;
      });
      expect(result).toBe(42);
      expect(await svc.isHeld("k")).toBe(true);
    });

    it("withLockWaiting outliving its TTL does not delete the lock another owner took", async () => {
      const svc = makeService();
      const result = await svc.withLockWaiting("k", 1800, async () => {
        vi.advanceTimersByTime(1_800_000);
        expect(await svc.tryAcquire("k", 1800)).toBe(true);
        return 42;
      });
      expect(result).toBe(42);
      expect(await svc.isHeld("k")).toBe(true);
    });
  });

  describe("withLock with retryOnRedisError", () => {
    const retry = { retryOnRedisError: true };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("without the option a Redis error throws at once and fn does not run", async () => {
      const svc = makeService();
      vi.spyOn(svc, "tryAcquireOwned").mockRejectedValue(new Error("ECONNREFUSED"));
      const fn = vi.fn(async () => 42);

      await expect(svc.withLock("k", 60, fn)).rejects.toThrow("ECONNREFUSED");
      expect(fn).not.toHaveBeenCalled();
    });

    it("retries after a Redis error with a growing delay, then runs fn once", async () => {
      const svc = makeService();
      const realTryAcquire = svc.tryAcquireOwned.bind(svc);
      const tryAcquire = vi
        .spyOn(svc, "tryAcquireOwned")
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockImplementation(realTryAcquire);
      const warn = vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);
      const fn = vi.fn(async () => 42);

      const pending = svc.withLock("k", 60, fn, retry);
      await vi.advanceTimersByTimeAsync(999);
      expect(tryAcquire).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(tryAcquire).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1999);
      expect(fn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(await pending).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.map((call) => call[0])).toEqual([
        expect.stringContaining("retrying in 1s"),
        expect.stringContaining("retrying in 2s"),
      ]);
      expect(await svc.isHeld("k")).toBe(false);
    });

    it("still skips a held key after a Redis error, without waiting for it", async () => {
      const svc = makeService();
      await svc.tryAcquire("k", 60);
      const realTryAcquire = svc.tryAcquireOwned.bind(svc);
      vi.spyOn(svc, "tryAcquireOwned")
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockImplementation(realTryAcquire);
      vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);
      const fn = vi.fn(async () => 42);

      const pending = svc.withLock("k", 60, fn, retry);
      await vi.advanceTimersByTimeAsync(1000);

      expect(await pending).toBeNull();
      expect(fn).not.toHaveBeenCalled();
      expect(await svc.isHeld("k")).toBe(true);
    });

    it("gives up with a clear error after the last Redis retry, without running fn", async () => {
      const svc = makeService();
      vi.spyOn(svc, "tryAcquireOwned").mockRejectedValue(new Error("ECONNREFUSED"));
      const warn = vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);
      const fn = vi.fn(async () => 42);

      const pending = svc.withLock("k", 60, fn, retry);
      const outcome = expect(pending).rejects.toThrow(
        `Redis unreachable while taking lock k: ${REDIS_RETRY_MAX_ATTEMPTS} attempts failed, last error: ECONNREFUSED`,
      );
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
      await outcome;

      expect(fn).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(REDIS_RETRY_MAX_ATTEMPTS - 1);
    });

    it("a Redis error on release is logged only with the option, and thrown without it", async () => {
      const svc = makeService();
      vi.spyOn(svc, "release").mockRejectedValue(new Error("ECONNRESET"));
      const warn = vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);

      expect(await svc.withLock("k", 60, async () => 42, retry)).toBe(42);
      expect(warn.mock.calls[0][0]).toContain("Redis error while releasing lock k");

      await expect(svc.withLock("k2", 60, async () => 42)).rejects.toThrow("ECONNRESET");
    });
  });

  describe("withLockWaiting", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("waits for a held key, then runs fn once and frees the key", async () => {
      const svc = makeService();
      await svc.tryAcquire("k", 60);
      const fn = vi.fn(async () => 42);

      const pending = svc.withLockWaiting("k", 60, fn, 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).not.toHaveBeenCalled();

      await svc.release("k");
      await vi.advanceTimersByTimeAsync(1000);

      expect(await pending).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(await svc.isHeld("k")).toBe(false);
    });

    it("retries after a Redis error with a growing delay, then runs fn once", async () => {
      const svc = makeService();
      const realTryAcquire = svc.tryAcquireOwned.bind(svc);
      const tryAcquire = vi
        .spyOn(svc, "tryAcquireOwned")
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockImplementation(realTryAcquire);
      const warn = vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);
      const fn = vi.fn(async () => 42);

      const pending = svc.withLockWaiting("k", 60, fn);
      await vi.advanceTimersByTimeAsync(999);
      expect(tryAcquire).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(tryAcquire).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1999);
      expect(fn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(await pending).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toContain(`attempt 1/${REDIS_RETRY_MAX_ATTEMPTS}`);
      expect(warn.mock.calls[0][0]).toContain("retrying in 1s");
      expect(warn.mock.calls[1][0]).toContain("retrying in 2s");
      expect(await svc.isHeld("k")).toBe(false);
    });

    it("gives up with a clear error after the last Redis retry, without running fn", async () => {
      const svc = makeService();
      vi.spyOn(svc, "tryAcquireOwned").mockRejectedValue(new Error("ECONNREFUSED"));
      const warn = vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);
      const fn = vi.fn(async () => 42);

      const pending = svc.withLockWaiting("k", 60, fn);
      const outcome = expect(pending).rejects.toThrow(
        `Redis unreachable while taking lock k: ${REDIS_RETRY_MAX_ATTEMPTS} attempts failed, last error: ECONNREFUSED`,
      );
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
      await outcome;

      expect(fn).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(REDIS_RETRY_MAX_ATTEMPTS - 1);
      expect(warn.mock.calls.at(-1)?.[0]).toContain("retrying in 30s");
    });

    it("a Redis error on release does not fail the run", async () => {
      const svc = makeService();
      vi.spyOn(svc, "release").mockRejectedValue(new Error("ECONNRESET"));
      const warn = vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);

      expect(await svc.withLockWaiting("k", 60, async () => 42)).toBe(42);
      expect(warn.mock.calls[0][0]).toContain("Redis error while releasing lock k");
    });

    it("releases the key when fn throws, and rethrows", async () => {
      const svc = makeService();
      const pending = svc.withLockWaiting("k", 60, async () => {
        throw new Error("boom");
      });
      await expect(pending).rejects.toThrow("boom");
      expect(await svc.isHeld("k")).toBe(false);
    });
  });

  describe("renewal while the guarded work runs", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    }

    function renewCalls(evalSpy: { mock: { calls: unknown[][] } }) {
      return evalSpy.mock.calls.filter((call) => String(call[0]).includes("pexpire"));
    }

    it("withLock renews every third of the TTL with the owner's token, so a run past the TTL keeps the lock", async () => {
      const svc = makeService();
      const set = vi.spyOn((svc as any).redis, "set");
      const evalSpy = vi.spyOn((svc as any).redis, "eval");
      const gate = deferred<number>();

      const pending = svc.withLock("k", 60, () => gate.promise);
      await vi.advanceTimersByTimeAsync(19_999);
      expect(renewCalls(evalSpy)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      const renewals = renewCalls(evalSpy);
      expect(renewals).toHaveLength(1);
      expect(renewals[0]).toEqual([expect.any(String), 1, "k", set.mock.calls[0][1], "60000"]);

      await vi.advanceTimersByTimeAsync(100_000);
      expect(renewCalls(evalSpy)).toHaveLength(6);
      expect(await svc.isHeld("k")).toBe(true);
      expect(await svc.tryAcquire("k", 60)).toBe(false);

      gate.resolve(42);
      expect(await pending).toBe(42);
      expect(await svc.isHeld("k")).toBe(false);
    });

    it("withLockWaiting renews the lock through a run longer than the TTL", async () => {
      const svc = makeService();
      const evalSpy = vi.spyOn((svc as any).redis, "eval");
      const gate = deferred<number>();

      const pending = svc.withLockWaiting("k", 1800, () => gate.promise);
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
      expect(renewCalls(evalSpy)).toHaveLength(12);
      expect(await svc.isHeld("k")).toBe(true);
      expect(await svc.tryAcquire("k", 1800)).toBe(false);

      gate.resolve(42);
      expect(await pending).toBe(42);
      expect(await svc.isHeld("k")).toBe(false);
    });

    it("stops renewing once fn settles, also when fn throws", async () => {
      const svc = makeService();
      const evalSpy = vi.spyOn((svc as any).redis, "eval");

      const ok = deferred<number>();
      const done = svc.withLock("a", 60, () => ok.promise);
      await vi.advanceTimersByTimeAsync(20_000);
      ok.resolve(1);
      await done;

      const failing = deferred<number>();
      const failed = svc.withLockWaiting("b", 60, () => failing.promise);
      const outcome = expect(failed).rejects.toThrow("boom");
      await vi.advanceTimersByTimeAsync(20_000);
      failing.resolve(Promise.reject(new Error("boom")) as unknown as number);
      await outcome;

      const before = renewCalls(evalSpy).length;
      expect(before).toBe(2);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(renewCalls(evalSpy)).toHaveLength(before);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a lost lock logs an error, stops renewing and lets fn finish", async () => {
      const svc = makeService();
      const evalSpy = vi.spyOn((svc as any).redis, "eval");
      const error = vi.spyOn((svc as any).logger, "error").mockImplementation(() => undefined);
      vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);
      const gate = deferred<number>();

      const pending = svc.withLock("k", 60, () => gate.promise);
      // Another process holds the key now (e.g. ours expired during a Redis outage).
      await svc.release("k");
      expect(await svc.tryAcquire("k", 600)).toBe(true);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain("Lock k was lost while its work was still running");

      await vi.advanceTimersByTimeAsync(60_000);
      expect(renewCalls(evalSpy)).toHaveLength(1);

      gate.resolve(42);
      expect(await pending).toBe(42);
      expect(await svc.isHeld("k")).toBe(true);
    });

    it("a Redis error on renewal is logged and the next renewal still runs", async () => {
      const svc = makeService();
      const redis = (svc as any).redis as FakeRedis;
      const realEval = redis.eval.bind(redis);
      const evalSpy = vi
        .spyOn(redis, "eval")
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockImplementation(realEval);
      const warn = vi.spyOn((svc as any).logger, "warn").mockImplementation(() => undefined);
      const gate = deferred<number>();

      const pending = svc.withLock("k", 60, () => gate.promise);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(warn.mock.calls[0][0]).toContain("Redis error while renewing lock k");
      await vi.advanceTimersByTimeAsync(20_000);
      expect(evalSpy).toHaveBeenCalledTimes(2);

      gate.resolve(42);
      expect(await pending).toBe(42);
    });
  });
});
