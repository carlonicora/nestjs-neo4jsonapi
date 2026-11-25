import { DynamicModule, Provider } from "@nestjs/common";
import { ScheduleExplorer, ScheduleModule } from "@nestjs/schedule";
import { LockedScheduleExplorer } from "./locked-schedule.explorer";

/**
 * `ScheduleModule.forRoot()` with its explorer replaced by `LockedScheduleExplorer`.
 *
 * - One Redis lock per `@Cron` method per scheduled tick, keyed `<queue>:cron-lock:<task>:<tickEpochMs>`:
 *   the tick is the scheduled fire time nearest to the worker's clock, read in the task's time zone
 *   (`nearestCronTickMs` in `locked-schedule.explorer.ts`). Workers firing the same tick up to half
 *   a gap early or late build the same key, so only the one that takes the lock runs it; the next
 *   tick has its own key.
 * - The lock is never released; it expires on its own. Since the key holds the tick, its lifetime
 *   does not bound which ticks run: it is the task's shortest gap, at least 60 seconds and at most
 *   5 minutes (`cronLockTtlMs`), long enough for the latest worker on the same tick to meet it.
 * - Workers whose clocks differ by half a gap or more can land on different ticks; keep clocks in
 *   sync (NTP) for second-level crons.
 * - A direct call of the method is not locked.
 * - There is no overlap guard: a run longer than the tick gap can overlap the next tick.
 */
export function createLockedScheduleModule(): DynamicModule {
  const base = ScheduleModule.forRoot();
  return {
    ...base,
    providers: (base.providers ?? []).map((provider: Provider): Provider =>
      provider === ScheduleExplorer ? { provide: ScheduleExplorer, useClass: LockedScheduleExplorer } : provider,
    ),
  };
}
