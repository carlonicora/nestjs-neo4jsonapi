import type { Reporter, TestModule, Vitest } from "vitest/node";

// ---------------------------------------------------------------------------
// Slow-test reporter. Added NEXT TO the default reporter (it never replaces it):
// at the end of every run it lists the tests whose duration exceeded a
// threshold, slowest first, so a test drifting toward its timeout is visible
// before it fails. Report-only: it never changes the run's exit code.
//
// Threshold: 1000 ms, overridable with VITEST_SLOW_TEST_MS.
//
// This file is deliberately duplicated in every workspace that runs Vitest
// (apps/api, apps/corpus, apps/web, packages/nestjs-neo4jsonapi,
// packages/nextjs-jsonapi): the two packages build and test standalone in their
// own repos and cannot import from the monorepo. Keep the copies identical.
// ---------------------------------------------------------------------------

export const DEFAULT_SLOW_TEST_MS = 1000;
export const MAX_SLOW_TEST_LINES = 20;

export interface SlowTestEntry {
  file: string;
  name: string;
  durationMs: number;
}

export function resolveSlowTestThreshold(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SLOW_TEST_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SLOW_TEST_MS;
}

/**
 * Pure formatting step: returns the lines to print, or an empty array when no
 * test exceeds the threshold.
 */
export function formatSlowTests(
  entries: ReadonlyArray<SlowTestEntry>,
  thresholdMs: number,
  maxLines: number = MAX_SLOW_TEST_LINES,
): string[] {
  const slow = entries.filter((entry) => entry.durationMs > thresholdMs).sort((a, b) => b.durationMs - a.durationMs);
  if (slow.length === 0) return [];

  const shown = slow.slice(0, maxLines);
  const width = Math.max(...shown.map((entry) => formatDuration(entry.durationMs).length));
  const lines = [`Slow tests (> ${thresholdMs} ms): ${slow.length}`];
  for (const entry of shown) {
    lines.push(`  ${formatDuration(entry.durationMs).padStart(width)}  ${entry.file} > ${entry.name}`);
  }
  if (slow.length > shown.length) {
    lines.push(`  ... and ${slow.length - shown.length} more`);
  }
  return lines;
}

function formatDuration(durationMs: number): string {
  return `${Math.round(durationMs)} ms`;
}

export default class SlowTestsReporter implements Reporter {
  private vitest: Vitest | undefined;

  onInit(vitest: Vitest): void {
    this.vitest = vitest;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    try {
      const entries: SlowTestEntry[] = [];
      for (const testModule of testModules) {
        for (const testCase of testModule.children.allTests()) {
          const diagnostic = testCase.diagnostic();
          if (!diagnostic) continue;
          entries.push({
            file: testModule.relativeModuleId,
            name: testCase.fullName,
            durationMs: diagnostic.duration,
          });
        }
      }

      const lines = formatSlowTests(entries, resolveSlowTestThreshold(process.env.VITEST_SLOW_TEST_MS));
      if (lines.length === 0) return;

      const output = ["", ...lines, ""].join("\n");
      if (this.vitest) this.vitest.logger.log(output);
      else process.stdout.write(`${output}\n`);
    } catch {
      // Report-only: a reporter failure must never fail the test run.
    }
  }
}
