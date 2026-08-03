export interface LLMRawResponse {
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: { cache_read?: number; cache_creation?: number };
    // The provider already returns `output_token_details.reasoning`; it was simply
    // untyped here and therefore discarded. Reasoning tokens are billed as output
    // and are the single biggest lever on latency, so they must be observable.
    output_token_details?: { reasoning?: number; audio?: number };
  };
  response_metadata?: { finish_reason?: string; [key: string]: unknown };
  content?: string;
}

export function isValidRaw(raw: unknown): raw is LLMRawResponse {
  return typeof raw === "object" && raw !== null;
}

export interface StructuredOutputResponse<T> {
  parsed: T | null;
  raw?: LLMRawResponse;
}
