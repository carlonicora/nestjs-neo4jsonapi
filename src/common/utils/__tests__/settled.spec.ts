import { describe, it, expect, vi } from "vitest";
import { allSettledKeepingSuccesses, runWithConcurrency } from "../settled";

describe("allSettledKeepingSuccesses", () => {
  it("keeps every fulfilled result when one task rejects", async () => {
    const onError = vi.fn();
    const results = await allSettledKeepingSuccesses<string>(
      [() => Promise.resolve("a"), () => Promise.reject(new Error("boom")), () => Promise.resolve("c")],
      onError,
    );

    expect(results).toEqual(["a", "c"]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe("boom");
    expect(onError.mock.calls[0][1]).toBe(1);
  });

  it("returns an empty array when every task rejects, and never throws", async () => {
    const onError = vi.fn();
    await expect(
      allSettledKeepingSuccesses<string>(
        [() => Promise.reject(new Error("x")), () => Promise.reject(new Error("y"))],
        onError,
      ),
    ).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});

describe("runWithConcurrency", () => {
  it("never runs more than `limit` tasks at once", async () => {
    let active = 0;
    let peak = 0;
    const make = () => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return "ok";
    };
    await runWithConcurrency(Array.from({ length: 10 }, make), 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("preserves input order", async () => {
    const tasks = [30, 5, 15].map((ms, i) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    const settled = await runWithConcurrency(tasks, 3);
    expect(settled.map((s) => (s.status === "fulfilled" ? s.value : -1))).toEqual([0, 1, 2]);
  });
});
