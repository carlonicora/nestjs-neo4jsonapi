/**
 * Event emitted after a token-usage record is persisted.
 *
 * Decouples usage recording from any consumer that reacts to it (e.g. the
 * company balance deduction in CompanyService), so the tokenusage module
 * never has to import CompanyModule — avoiding a circular module/import graph.
 */
export const TOKEN_USAGE_RECORDED_EVENT = "tokenusage.recorded";

export interface TokenUsageRecordedPayload {
  input: number;
  output: number;
}
