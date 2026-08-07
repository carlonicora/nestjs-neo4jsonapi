/**
 * Summariser agent behaviour switches.
 *
 * Both options are opt-in: when omitted the summariser keeps its default
 * behaviour (no sentinel handling, no TL;DR sanitizing).
 */
export interface ConfigSummariserInterface {
  /**
   * Sentinel string the combine prompt may return to signal "nothing worth
   * summarising" (e.g. `"NO_SUMMARY"`). When the combine output equals this
   * value (case-insensitive, trimmed) the summariser returns
   * `{ content: "", tldr: "" }` instead of the raw sentinel.
   */
  emptySentinel?: string;

  /**
   * When true, the generated TL;DR is stripped of markdown formatting via
   * `sanitizeTldr()` before being returned.
   */
  sanitizeTldr?: boolean;
}
