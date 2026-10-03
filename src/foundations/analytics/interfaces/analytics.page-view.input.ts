/**
 * Input accepted by `AnalyticsService.track()` and queued as the BullMQ job
 * payload consumed by `AnalyticsProcessor`.
 *
 * `clientIp` and `userAgent` travel only as far as the worker: they are hashed
 * into the daily visitor id and classified into a `deviceType`, then discarded.
 * Neither ever reaches Neo4j.
 */
export interface AnalyticsPageViewInput {
  path: string;
  section: "public" | "app";
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  /** UUID from the consent cookie; absent when the visitor has not consented. */
  visitorId?: string;
  screenWidth?: number;
  /** First `X-Forwarded-For` hop or `request.ip`. Hashed in the worker, never stored. */
  clientIp: string;
  /** Hashed and classified in the worker, never stored. */
  userAgent: string;
  /** Set by `OptionalJwtAuthGuard` when the request carries a valid token. */
  userId?: string;
  /** ISO instant set by the controller when the request arrived. */
  receivedAt: string;
}
