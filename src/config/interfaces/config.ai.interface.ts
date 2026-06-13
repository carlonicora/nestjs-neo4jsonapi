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
  /**
   * OpenRouter only: whether `region` (sent as `provider.order`) permits routing
   * to other providers on failure/load. `true` (default) makes the pin a mere
   * preference — OpenRouter may reroute to ANY provider, including ones with
   * mandatory output moderation (e.g. Alibaba) that abort explicit content
   * mid-stream. `false` makes `region` a hard pin: the request fails loudly
   * rather than silently rerouting. Set per tier via `AI_ALLOW_FALLBACKS{suffix}`.
   */
  allowFallbacks?: boolean;
  /** Base64-encoded GCP service account JSON for Google Vertex AI */
  googleCredentialsBase64?: string;
}

export interface ConfigAiInterface {
  /** Normal tier — the default model. */
  ai: AiTierConfig;
  /**
   * Lite tier — cheaper/faster. Falls back field-by-field to `ai` unless it
   * declares a different provider, in which case it is standalone.
   */
  aiLite: AiTierConfig;
  /**
   * Large tier — more capable. Falls back field-by-field to `ai` unless it
   * declares a different provider, in which case it is standalone.
   */
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
    /**
     * Request format for the direct (`directUrl`) endpoint:
     *   - "multipart" (default) — OpenAI / self-hosted Whisper multipart form-data.
     *   - "json" — OpenRouter-style JSON body with base64 `input_audio`.
     * Set via AUDIO_DIRECT_FORMAT. Ignored in chat mode.
     */
    directFormat?: string;
    /**
     * Optional provider to pin for the JSON direct endpoint, sent as
     * `provider.order` with `allow_fallbacks: false`. Lets you route around a
     * dead provider (e.g. OpenRouter's Groq `whisper-large-v3` endpoint 400s
     * everything — pin "Together" instead). Set via AUDIO_DIRECT_PROVIDER.
     */
    directProvider?: string;
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
