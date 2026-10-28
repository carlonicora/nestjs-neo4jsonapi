/**
 * Job payload queued by `AnalyticsService.track()` when it drops a page view
 * because the caller holds an excluded role. `AnalyticsProcessor` resolves the
 * same visitor ids a page view would get and deletes that visitor's anonymous
 * sessions, so the views recorded before the login leave Analytics too.
 *
 * `clientIp` and `userAgent` are only hashed in the worker, never stored.
 */
export interface AnalyticsPurgeVisitorInput {
  /** UUID from the consent cookie; absent when the visitor has not consented. */
  visitorId?: string;
  clientIp: string;
  userAgent: string;
  /** ISO instant set by the controller when the request arrived. */
  receivedAt: string;
}

/** The purge job name: the configured page-view job name plus this suffix. */
export const ANALYTICS_PURGE_JOB_SUFFIX = ":purgeVisitor";
