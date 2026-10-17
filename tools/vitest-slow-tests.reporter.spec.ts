import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLOW_TEST_MS,
  formatSlowTests,
  resolveSlowTestThreshold,
  type SlowTestEntry,
} from "../vitest.slow-tests.reporter";

const entry = (name: string, durationMs: number, file = "src/a.spec.ts"): SlowTestEntry => ({ file, name, durationMs });

describe("formatSlowTests", () => {
  it("returns nothing when no test exceeds the threshold", () => {
    expect(formatSlowTests([entry("fast", 10), entry("at threshold", 1000)], 1000)).toEqual([]);
  });

  it("lists only tests above the threshold, slowest first, with file, name and duration", () => {
    const lines = formatSlowTests(
      [entry("a", 1500), entry("fast", 20), entry("b", 4200.6, "src/b.spec.ts"), entry("c", 1001)],
      1000,
    );

    expect(lines).toEqual([
      "Slow tests (> 1000 ms): 3",
      "  4201 ms  src/b.spec.ts > b",
      "  1500 ms  src/a.spec.ts > a",
      "  1001 ms  src/a.spec.ts > c",
    ]);
  });

  it("caps the list and counts the rest", () => {
    const entries = Array.from({ length: 25 }, (_, i) => entry(`t${i}`, 2000 + i));
    const lines = formatSlowTests(entries, 1000, 20);

    expect(lines[0]).toBe("Slow tests (> 1000 ms): 25");
    expect(lines).toHaveLength(1 + 20 + 1);
    expect(lines[1]).toContain("t24");
    expect(lines[lines.length - 1]).toBe("  ... and 5 more");
  });
});

describe("resolveSlowTestThreshold", () => {
  it("defaults to 1000 ms when unset, empty or invalid", () => {
    expect(DEFAULT_SLOW_TEST_MS).toBe(1000);
    expect(resolveSlowTestThreshold(undefined)).toBe(1000);
    expect(resolveSlowTestThreshold("")).toBe(1000);
    expect(resolveSlowTestThreshold("abc")).toBe(1000);
    expect(resolveSlowTestThreshold("-5")).toBe(1000);
  });

  it("uses the env value when it is a valid number", () => {
    expect(resolveSlowTestThreshold("250")).toBe(250);
    expect(resolveSlowTestThreshold("0")).toBe(0);
  });
});
