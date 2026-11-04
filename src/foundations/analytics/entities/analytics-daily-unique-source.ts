/**
 * The three sources of one day's unique counts, as read by
 * AnalyticsAdminRepository.findDailyUniques. The service picks the counts by
 * the four rules (stored, then raw, then unknown for an old summary, then 0).
 *
 * Not a JSON:API resource — an internal row shape only.
 */
export type AnalyticsDailyUniqueSourceEntity = {
  /** YYYY-MM-DD, via convertFieldValue(..., "date"). */
  day: string;
  /** The stored AnalyticsDailyUnique node's counts, if the day was rolled up. */
  stored: { visitors: number; users: number } | null;
  /** Counts from the raw sessions still stored for the day. */
  raw: { visitors: number; users: number } | null;
  /** An old AnalyticsDailySummary total row exists for the day. */
  hasOldSummary: boolean;
};
