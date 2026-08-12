/**
 * Maps `items` through `fn` with AT MOST `limit` invocations in flight.
 *
 * Why this exists: `Promise.all(items.map(fn))` starts EVERY task at once. On a
 * per-chunk LLM fan-out that means one socket and one full request payload per
 * chunk, simultaneously — which is how a 760-page cost-test run produced a burst
 * of 28 `ENOTFOUND` DNS failures (the resolver was swamped) while also pinning
 * every in-flight prompt in the heap at the same moment. Bounding the fan-out
 * fixes both: a fixed number of sockets, and a fixed number of live payloads.
 *
 * Semantics:
 * - Results come back in INPUT order, regardless of completion order.
 * - Never more than `limit` calls to `fn` are pending at any instant.
 * - The FIRST rejection is remembered and rethrown, but only AFTER every worker
 *   has drained; no new item is started once a rejection has been seen, so a
 *   doomed batch stops spending. Nothing is left running behind the throw.
 * - An empty `items` resolves to `[]` without calling `fn`.
 *
 * `limit` is clamped to at least 1 and never exceeds `items.length`, so callers
 * may pass a configured value without guarding it.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;

  const workerCount = Math.min(Math.max(1, Math.floor(limit) || 1), items.length);

  let cursor = 0;
  let failed = false;
  let firstError: unknown;

  const worker = async (): Promise<void> => {
    for (;;) {
      // A rejection elsewhere stops this worker from claiming more work; the
      // items already in flight still finish so nothing is orphaned.
      if (failed) return;
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (failed) throw firstError;
  return results;
}
