import { describe, it, expect, vi, type Mocked } from "vitest";
import { JobRunService } from "../job-run.service";
import { RedisLockService } from "../redis.lock.service";

function makeLock(): { lock: Mocked<RedisLockService>; store: Map<string, string> } {
  const store = new Map<string, string>();
  let next = 0;
  const lock: Partial<Mocked<RedisLockService>> = {
    scopedKey: vi.fn<RedisLockService["scopedKey"]>((name) => `q:lock:${name}`),
    tryAcquire: vi.fn<RedisLockService["tryAcquire"]>(async (key) => {
      if (store.has(key)) return false;
      store.set(key, `marker-${++next}`);
      return true;
    }),
    tryAcquireOwned: vi.fn<RedisLockService["tryAcquireOwned"]>(async (key) => {
      if (store.has(key)) return null;
      const token = `token-${++next}`;
      store.set(key, token);
      return token;
    }),
    isHeld: vi.fn<RedisLockService["isHeld"]>(async (key) => store.has(key)),
    release: vi.fn<RedisLockService["release"]>(async (key, token) => {
      if (token === undefined || store.get(key) === token) store.delete(key);
    }),
  };
  return { lock: lock as Mocked<RedisLockService>, store };
}

function makeFailingLock(): Mocked<RedisLockService> {
  const error = new Error("redis down");
  const lock: Partial<Mocked<RedisLockService>> = {
    scopedKey: vi.fn<RedisLockService["scopedKey"]>((name) => `q:lock:${name}`),
    tryAcquire: vi.fn<RedisLockService["tryAcquire"]>().mockRejectedValue(error),
    tryAcquireOwned: vi.fn<RedisLockService["tryAcquireOwned"]>().mockRejectedValue(error),
    isHeld: vi.fn<RedisLockService["isHeld"]>().mockRejectedValue(error),
    release: vi.fn<RedisLockService["release"]>().mockRejectedValue(error),
  };
  return lock as Mocked<RedisLockService>;
}

const job = { queueName: "q1", id: "7", timestamp: 100 };

describe("JobRunService", () => {
  it("key joins queue, id and timestamp with no colon", () => {
    const service = new JobRunService(makeLock().lock);
    const key = service.key(job);
    expect(key).toBe("q1-7-100");
    expect(key).not.toContain(":");
  });

  it("isCompleted is false until markCompleted, and only for that job instance", async () => {
    const service = new JobRunService(makeLock().lock);
    expect(await service.isCompleted(job)).toBe(false);
    await service.markCompleted(job);
    expect(await service.isCompleted(job)).toBe(true);
    expect(await service.isCompleted({ ...job, timestamp: 200 })).toBe(false);
  });

  it("markCompleted keeps the marker for 24 hours", async () => {
    const { lock } = makeLock();
    const service = new JobRunService(lock);
    await service.markCompleted(job);
    expect(lock.tryAcquire).toHaveBeenCalledWith(lock.scopedKey("job-done:q1-7-100"), 86400);
  });

  it("claim is true the first time, false after, and true again after unclaim", async () => {
    const service = new JobRunService(makeLock().lock);
    expect(await service.claim("a")).toBe(true);
    expect(await service.claim("a")).toBe(false);
    await service.unclaim("a");
    expect(await service.claim("a")).toBe(true);
  });

  it("unclaim releases with the token the claim took", async () => {
    const { lock, store } = makeLock();
    const service = new JobRunService(lock);
    await service.claim("a");
    const token = store.get("q:lock:once:a");
    await service.unclaim("a");
    expect(lock.release).toHaveBeenCalledWith("q:lock:once:a", token);
    expect(store.has("q:lock:once:a")).toBe(false);
  });

  it("a late unclaim after the claim expired and another owner took it leaves that claim in place", async () => {
    const { lock, store } = makeLock();
    const service = new JobRunService(lock);
    expect(await service.claim("a")).toBe(true);
    // The TTL lapses and another worker claims the same name.
    store.delete("q:lock:once:a");
    store.set("q:lock:once:a", "other-owner");
    await service.unclaim("a");
    expect(store.get("q:lock:once:a")).toBe("other-owner");
  });

  it("unclaim of a name this instance never claimed deletes nothing", async () => {
    const { lock, store } = makeLock();
    const service = new JobRunService(lock);
    store.set("q:lock:once:a", "other-owner");
    expect(await service.claim("a")).toBe(false);
    await service.unclaim("a");
    expect(lock.release).not.toHaveBeenCalled();
    expect(store.get("q:lock:once:a")).toBe("other-owner");
  });

  it("never fails the job on a Redis error", async () => {
    const service = new JobRunService(makeFailingLock());
    await expect(service.isCompleted(job)).resolves.toBe(false);
    await expect(service.claim("a")).resolves.toBe(true);
    await expect(service.markCompleted(job)).resolves.toBeUndefined();
    await expect(service.unclaim("a")).resolves.toBeUndefined();
  });

  it("a Redis error while releasing an owned claim does not throw", async () => {
    const { lock } = makeLock();
    lock.release.mockRejectedValue(new Error("redis down"));
    const service = new JobRunService(lock);
    await service.claim("a");
    await expect(service.unclaim("a")).resolves.toBeUndefined();
  });

  it("a failClosed claim is false on a Redis error", async () => {
    const service = new JobRunService(makeFailingLock());
    await expect(service.claim("a", 60, { failClosed: true })).resolves.toBe(false);
    await expect(service.claim("a", 60, { failClosed: false })).resolves.toBe(true);
  });

  it("a failClosed claim still claims once when Redis answers", async () => {
    const { lock } = makeLock();
    const service = new JobRunService(lock);
    expect(await service.claim("a", 60, { failClosed: true })).toBe(true);
    expect(await service.claim("a", 60, { failClosed: true })).toBe(false);
    expect(lock.tryAcquireOwned).toHaveBeenCalledWith(lock.scopedKey("once:a"), 60);
  });

  it("usageId is a stable version-5 UUID per job attempt and scope", () => {
    const service = new JobRunService(makeLock().lock);
    const id = service.usageId(job, "s");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(service.usageId({ ...job }, "s")).toBe(id);
    expect(service.usageId({ ...job, attemptsMade: 1 }, "s")).not.toBe(id);
    expect(service.usageId({ ...job, timestamp: 101 }, "s")).not.toBe(id);
    expect(service.usageId(job, "t")).not.toBe(id);
  });
});
