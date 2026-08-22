/**
 * Runs every task and keeps the fulfilled results, reporting rejections through
 * `onError` instead of propagating them.
 *
 * A bare `Promise.all` over a retrieval fan-out throws away every sibling result
 * when one call fails — measured at 19.4% of chat turns, with the surviving
 * calls billed and discarded. Never rejects.
 *
 * Semantics:
 * - Every task is started, exactly as `Promise.all(tasks.map(t => t()))` would.
 * - Fulfilled values come back in INPUT order, with rejected slots removed, so
 *   the result may be SHORTER than `tasks`.
 * - `onError` receives the rejection reason and the task's INDEX in `tasks`,
 *   so the caller can name the item that failed.
 * - An empty `tasks` resolves to `[]` without calling `onError`.
 */
export async function allSettledKeepingSuccesses<T>(
  tasks: Array<() => Promise<T>>,
  onError: (error: unknown, index: number) => void,
): Promise<T[]> {
  const settled = await Promise.allSettled(tasks.map((task) => task()));
  const kept: T[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") kept.push(outcome.value);
    else onError(outcome.reason, index);
  });
  return kept;
}

/**
 * Caps how many tasks run concurrently, preserving input order in the result.
 *
 * The embedder already gates itself (rate-limited-embedder.ts:55); the LLM path
 * does not, so a large fan-out opens one provider connection per item.
 *
 * Unlike `mapWithConcurrency` (src/common/helpers/map-with-concurrency.ts) this
 * NEVER rejects and never stops early: it drains every task and hands back one
 * `PromiseSettledResult` per input slot, in input order, so the caller decides
 * what a rejection means.
 *
 * `limit` is clamped to at least 1 and never exceeds `tasks.length`, so callers
 * may pass a configured value without guarding it.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
  return results;
}
