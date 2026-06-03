/**
 * Configuration for a single AI text-generation model tier.
 * Shared shape for the `ai` (normal), `aiLite`, and `aiLarge` blocks.
 */
export interface AiTierConfig {
  provider: string;
  apiKey: string;
  model: string;
  url: string;
  region?: string;
  secret?: string;
  instance?: string;
  apiVersion?: string;
  inputCostPer1MTokens: number;
  outputCostPer1MTokens: number;
  maxOutputTokens?: number;
  /** Base64-encoded GCP service account JSON for Google Vertex AI */
  googleCredentialsBase64?: string;
}

export interface ConfigAiInterface {
  /** Normal tier — the default model. */
  ai: AiTierConfig;
  /** Lite tier — cheaper/faster. Falls back field-by-field to `ai`. */
  aiLite: AiTierConfig;
  /** Large tier — more capable. Falls back field-by-field to `ai`. */
  aiLarge: AiTierConfig;
  vision: {
    provider: string;
    apiKey: string;
    model: string;
    url: string;
    region?: string;
    secret?: string;
    instance?: string;
    apiVersion?: string;
    inputCostPer1MTokens: number;
    outputCostPer1MTokens: number;
    /** Base64-encoded GCP service account JSON for Google Vertex AI */
    googleCredentialsBase64?: string;
  };
  audio: {
    provider: string;
    apiKey: string;
    model: string;
    url: string;
    region?: string;
    secret?: string;
    instance?: string;
    apiVersion?: string;
    inputCostPer1MTokens: number;
    outputCostPer1MTokens: number;
    /** Base64-encoded GCP service account JSON for Google Vertex AI */
    googleCredentialsBase64?: string;
    /**
     * Full URL of an OpenAI-style /audio/transcriptions endpoint. When set,
     * AudioLLMService POSTs a multipart request here (using `apiKey` as Bearer
     * auth and `model` / `language` from this same audio config). When unset
     * or empty, the chat-LLM path is used instead (via ModelService.getAudioLLM).
     * No provider whitelist — any OpenAI-compatible STT endpoint works.
     */
    directUrl?: string;
    /** ISO-639-1 hint passed to /audio/transcriptions. Ignored in chat mode. */
    language?: string;
  };
  embedder: {
    provider: string;
    apiKey: string;
    url: string;
    model: string;
    instance?: string;
    apiVersion?: string;
    dimensions: number;
    /** GCP region for Google Vertex AI embeddings (e.g., "us-central1") */
    region?: string;
    /** Base64-encoded GCP service account JSON for Google Vertex AI */
    googleCredentialsBase64?: string;
  };
}
