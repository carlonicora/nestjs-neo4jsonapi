/**
 * Credits are the billing unit exposed to customers: a fractional, tier-accurate
 * conversion of the real provider cost of an AI call.
 *
 * `credits = max(minCreditsPerRecord, round2(cost / creditCost))`, where `cost`
 * is the euro figure produced by `TokenUsageService.computeCost` (or an explicit
 * `costOverride`). ALL monetary values here — and every `*_COST_PER_1M_TOKENS`
 * env value feeding `cost` — are expressed in EUROS.
 *
 * `creditCost: 0` (or an absent `credits` config block) DISABLES credits: usage
 * records store `credits: 0` and no balance is deducted, so package consumers
 * that never set `CREDIT_COST` keep their pre-credits behaviour.
 */
export interface ConfigCreditsInterface {
  /** € per credit; driven by CREDIT_COST. 0 → credits tracking disabled. */
  creditCost: number;
  /**
   * Floor applied to every recorded call so sub-cent calls are still billed;
   * driven by CREDIT_MINIMUM (default 0.1). Skipped when the caller passes
   * `applyMinimum: false` (embeddings).
   */
  minCreditsPerRecord: number;
}
