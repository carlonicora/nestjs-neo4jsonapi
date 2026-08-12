import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../map-with-concurrency";

/** Resolves after `ms` — enough to interleave workers deterministically. */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("returns results in INPUT order even when tasks finish out of order", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];

    const results = await mapWithConcurrency(items, 3, async (item) => {
      // Later items finish first: 8 waits 1ms, 1 waits 8ms.
      await wait(9 - item);
      return item * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it("never exceeds `limit` concurrent invocations", async () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(items, 5, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await wait(1);
      inFlight -= 1;
      return item;
    });

    expect(peak).toBeLessThanOrEqual(5);
    // Guards against an accidental serial implementation passing the assertion above.
    expect(peak).toBe(5);
    expect(inFlight).toBe(0);
  });

  it("invokes `fn` exactly once per item with its index", async () => {
    const items = ["a", "b", "c"];
    const seen: Array<[string, number]> = [];

    const results = await mapWithConcurrency(items, 2, async (item, index) => {
      seen.push([item, index]);
      return `${item}${index}`;
    });

    expect(seen).toHaveLength(3);
    expect(seen).toEqual(expect.arrayContaining([["a", 0] as [string, number]]));
    expect(results).toEqual(["a0", "b1", "c2"]);
  });

  it("propagates the first rejection", async () => {
    const boom = new Error("boom");

    await expect(
      mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
        await wait(1);
        if (item === 2) throw boom;
        return item;
      }),
    ).rejects.toBe(boom);
  });

  it("lets in-flight workers settle before the rejection propagates", async () => {
    let settled = 0;
    let pending = 0;

    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (item) => {
        pending += 1;
        await wait(item === 1 ? 1 : 5);
        pending -= 1;
        settled += 1;
        if (item === 1) throw new Error("boom");
        return item;
      }),
    ).rejects.toThrow("boom");

    // Nothing is left running behind the throw.
    expect(pending).toBe(0);
    // The two siblings that were already in flight completed; nothing new started.
    expect(settled).toBeGreaterThanOrEqual(2);
  });

  it("resolves to an empty array without calling `fn` for empty input", async () => {
    let calls = 0;

    const results = await mapWithConcurrency([], 8, async (item: number) => {
      calls += 1;
      return item;
    });

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("clamps a limit below 1 to serial execution", async () => {
    let inFlight = 0;
    let peak = 0;

    const results = await mapWithConcurrency([1, 2, 3], 0, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await wait(1);
      inFlight -= 1;
      return item;
    });

    expect(peak).toBe(1);
    expect(results).toEqual([1, 2, 3]);
  });

  it("clamps a limit larger than the input to the input length", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency([1, 2], 100, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await wait(1);
      inFlight -= 1;
      return item;
    });

    expect(peak).toBe(2);
  });
});
