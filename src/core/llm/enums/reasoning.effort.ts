/**
 * How much hidden "thinking" a reasoning model may spend before answering.
 *
 * Sent as the OpenAI-compatible `reasoning_effort` chat-completions parameter.
 * Lower settings trade depth for latency and cost: measured against a live
 * gpt-5-nano deployment on an analysis-shaped prompt, the default spent 3136 of
 * 3397 output tokens on reasoning (28.2s), while "low" spent 128 (8.3s).
 *
 * Not every model accepts every value — "none" is newer than the rest. A value a
 * provider rejects is stripped and remembered by `unsupportedParamFetch`, so an
 * unsupported setting degrades to the provider default rather than failing.
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
