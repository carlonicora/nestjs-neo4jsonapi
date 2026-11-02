/** Header the offline-change-set runner sets on every change it runs through an app route. */
export const OFFLINE_REPLAY_HEADER = "x-offline-replay";

/** Header carrying the per-process token of a change-set step (never sent by a browser). */
export const OFFLINE_INTERNAL_HEADER = "x-offline-internal";

/** CLS key: `true` while the current request is a change replayed from an offline package. */
export const OFFLINE_CLS_REPLAY = "offline.replay";

/** DI token holding the `bootstrap({ offline })` options; bound only when offline is configured. */
export const OFFLINE_OPTIONS = Symbol("OFFLINE_OPTIONS");

export type OfflineOptions = { changeSets: boolean };
