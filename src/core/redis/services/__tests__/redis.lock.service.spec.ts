import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RedisLockService } from "../redis.lock.service";

// Minimal mock of ioredis behavior for SET ... NX EX semantics.
class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();
  async set(key: string, value: string, _ex: "EX", ttlSec: number, _nx: "NX") {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > now) return null;
    this.store.set(key, { value, expiresAt: now + ttlSec * 1000 });
    return "OK";
  }
  async del(key: string) {
    this.store.delete(key);
    return 1;
  }
  async quit() {
    /* no-op */
  }
}

function makeService() {
  const svc = new RedisLockService({
    get: () => ({ host: "localhost", port: 6379, username: undefined, password: undefined }),
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
});
