export interface TokenUsageInterface {
  input: number;
  output: number;
  /** Cache-read input tokens (a subset of `input`). Billed at the cached rate. Default 0. */
  cached?: number;
}
