/**
 * Environment-driven switch for the first-party web analytics module.
 *
 * Read from `ANALYTICS_ENABLED`, `ANALYTICS_RETENTION_MONTHS` and
 * `ANALYTICS_SESSION_TIMEOUT_MINUTES`. `AnalyticsModule.forRoot()` merges this
 * over its defaults; an explicit `bootstrap({ analytics })` still overrides it.
 */
export interface ConfigAnalyticsInterface {
  enabled: boolean;
  retentionMonths: number;
  sessionTimeoutMinutes: number;
}
