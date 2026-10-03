/**
 * Input accepted by `AnalyticsSessionRepository.recordPageView()`.
 *
 * Built by `AnalyticsProcessor` from an `AnalyticsPageViewInput` once the
 * visitor id is resolved, the route normalised and the user agent reduced to a
 * `deviceType`. Optional values are `null` rather than `undefined` so they can
 * be bound straight into Cypher parameters.
 */
export interface AnalyticsResolvedPageView {
  /** `c:<uuid>` from the consent cookie or `d:<sha256>` daily hash. */
  visitorId: string;
  consented: boolean;
  path: string;
  /** `path` with UUID segments replaced by `:id`. */
  route: string;
  section: "public" | "app";
  /** Hostname of the external referrer, `null` for internal or missing referrers. */
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  deviceType: string;
  userId: string | null;
  /** ISO instant; becomes the page view's `createdAt` and the session's `lastSeenAt`. */
  receivedAt: string;
  sessionTimeoutMinutes: number;
}
