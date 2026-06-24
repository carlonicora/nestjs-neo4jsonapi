export interface LLMRawResponse {
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: { cache_read?: number; cache_creation?: number };
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
