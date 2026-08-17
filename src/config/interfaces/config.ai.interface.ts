/**
 * AI Configuration Environment Variables (Security Hardening 2026-06-19)
 *
 * ASSISTANT_DUMP_LLM_REDACT
 *   "true" | "false" (default: unset = off)
 *   When "true", LLM dump files have user prompts, history content,
 *   and consent-related system prompts replaced with "[REDACTED]".
 *   Production deployments should set this to "true".
 *
 * ASSISTANT_DUMP_LLM_KEEP_FIELDS
 *   Comma-separated dot-paths to preserve despite redaction.
 *   Example: "metadata.gameId,metadata.roundId"
 *
 * AI_URL_ALLOWLIST
 *   Comma-separated hostnames that AI_URL is allowed to point at.
 *   Subdomains are allowed (e.g. "openai.com" permits "api.openai.com").
 *   If unset, any HTTPS hostname is permitted.
 */

/**
 * LangSmith tracing (developer observability)
 *
 * LangSmith traces every LLM call as a structured run tree — the LangChain /
 * LangGraph path (call / extractViaTool / the tool loop, and the whole game-play
 * StateGraph) is traced natively, and the Vercel AI SDK streaming path (narrate
 * and structured streaming) is traced via `wrapAISDK` in `llm.service.ts`. All of
 * it is gated entirely by env vars — set none and there is zero tracing and zero
 * overhead.
 *
 * LANGSMITH_TRACING        "true" to enable (legacy alias: LANGCHAIN_TRACING_V2)
 * LANGSMITH_API_KEY        LangSmith API key (legacy alias: LANGCHAIN_API_KEY)
 * LANGSMITH_PROJECT        Project name to group traces (legacy alias: LANGCHAIN_PROJECT)
 * LANGSMITH_ENDPOINT       Region/self-hosted base URL (legacy alias: LANGCHAIN_ENDPOINT).
 *                          EU: "https://eu.api.smith.langchain.com". Default is the US
 *                          endpoint. The API key MUST belong to a workspace in the same
 *                          region as the endpoint, or traces are rejected (403).
 *
 * Per-call `metadata` (nodeName, agentName, …) forwarded in `LLMService` appears
 * on each run for filtering. This is a dev/debug tool, distinct from the in-app
 * websocket telemetry (live play UI) and the persisted Neo4j TokenUsage (cost).
 */

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
  /**
   * Optional discounted rate for cached (cache-read) input tokens, which providers
   * report as a SUBSET of the input tokens. When unset, cached tokens are billed at
   * `inputCostPer1MTokens` (no discount). Set via AI_CACHED_INPUT_COST_PER_1M_TOKENS.
   */
  cachedInputCostPer1MTokens?: number;
  maxOutputTokens?: number;
  /**
   * Default `reasoning_effort` for this tier, used when a call does not pass its
   * own. Unset means nothing is sent and the provider default applies. Set per
   * tier via `AI_REASONING_EFFORT{suffix}`. Mirrors `vision.reasoningEffort`.
   */
  reasoningEffort?: string;
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
  /**
   * MOCK_AI fail-closed safety gate. When `true`, the LLM/model/embedder layer
   * returns synthetic data instead of calling any provider (FakeListChatModel,
   * zero-vector embedder, mockFromZodSchema structured output). MUST NEVER be
   * `true` in production — ModelService.onModuleInit throws on
   * `ENV === "production"` to enforce this. Driven by MOCK_AI=true.
   */
  mock: boolean;
  /**
   * Per-ATTEMPT wall-clock budget for one provider request, in milliseconds.
   * Driven by AI_REQUEST_TIMEOUT_MS (default 120000).
   *
   * Without it the only bound is the OpenAI SDK's own 600s default, so a
   * provider that accepts a request and never answers freezes the caller for
   * ten minutes with no error, no log and no dump (the dump file is written on
   * close). Callers that need a different bound pass `timeout` per call.
   *
   * This is the budget for ONE attempt: the LangChain retry layer may re-issue
   * (on OpenRouter each retry escalates `allow_fallbacks`, so a stalled provider
   * is rerouted rather than waited on again). {@link requestDeadlineAttempts}
   * bounds the total.
   */
  requestTimeoutMs: number;
  /**
   * How many attempts the absolute deadline budgets for before it force-fails a
   * call, so an adapter that ignores its own timeout still settles. Driven by
   * AI_REQUEST_DEADLINE_ATTEMPTS (default 3 — matches LangChain's maxRetries: 2
   * plus the first attempt).
   */
  requestDeadlineAttempts: number;
  /**
   * How often, in milliseconds, a still-pending provider request logs a warning.
   * Driven by AI_REQUEST_WATCHDOG_MS (default 30000). A stall used to be
   * completely silent until it resolved; this makes it visible while it happens.
   * Set to 0 to disable.
   */
  requestWatchdogMs: number;
  /**
   * Minutes a failed AI connection is skipped before re-entering its fallback
   * chain (AI_CONNECTION_COOLDOWN_MINUTES, default 5).
   */
  connectionCooldownMinutes: number;
  /**
   * Mistral Document AI (OCR) on Azure AI Foundry — see DocumentAiService.
   * Driven by DOCUMENT_AI_{ENABLED,PROVIDER,API_KEY,MODEL,URL,API_VERSION,COST_PER_PAGE}.
   */
  documentAi: {
    enabled: boolean;
    provider: string;
    apiKey: string;
    model: string;
    url: string;
    apiVersion?: string;
    /**
     * € per OCR page, driven by DOCUMENT_AI_COST_PER_PAGE. OCR is billed per page and
     * returns no token counts, so callers charge `pages * costPerPage` as the
     * `costOverride` on the usage record. Like every monetary value in this config it is
     * expressed in EUROS (see `config.credits.interface.ts` — "ALL monetary values here …
     * are expressed in EUROS"). 0 or unset → OCR pages are free and no usage record is
     * written for them.
     */
    costPerPage?: number;
  };
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
    /**
     * gpt-5 / o-series reasoning models only: "minimal" | "low" | "medium" | "high".
     * Lower effort → faster, fewer reasoning tokens. Passed as a raw `reasoning_effort`
     * modelKwarg (the LangChain `reasoning` object is rejected by Azure chat-completions
     * deployments). Ignored for non-reasoning models. Set via VISION_REASONING_EFFORT.
     */
    reasoningEffort?: string;
  };
  /**
   * Image GENERATION (not analysis — that is `vision`). Drives ImageLLMService:
   * an OpenRouter-style chat-completions call with modalities ["image","text"].
   * Driven by IMAGE_* env vars, falling back to AI_* like vision/audio do.
   */
  image: {
    provider: string;
    apiKey: string;
    model: string;
    url: string;
    inputCostPer1MTokens: number;
    outputCostPer1MTokens: number;
  };
  /**
   * SDK-based audio transcription (OpenAI / Azure OpenAI `audio.transcriptions`).
   * Distinct from the `audio` block above (chat-LLM / OpenAI-style /audio/transcriptions
   * HTTP path used by AudioLLMService): this drives ModelService.getTranscriber() /
   * transcribeAudio() via the openai SDK. Driven by TRANSCRIBER_* env vars.
   */
  transcriber: {
    provider: string;
    apiKey: string;
    model: string;
    url?: string;
    apiVersion?: string;
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
    /**
     * Price of one minute of transcribed audio, in the same currency as the
     * per-token rates. Set via AUDIO_COST_PER_MINUTE.
     *
     * This is what makes the `directUrl` engine billable. That endpoint reports
     * no token counts, so a token-priced call costs nothing and - under the
     * zero-token rule - recorded nothing at all: switching engines silently
     * turned transcription into free work. With a rate here the cost is derived
     * from the measured audio duration instead, so the choice of engine no
     * longer decides whether the work is billed.
     *
     * Leave unset (or 0) only if you accept that the direct engine bills
     * nothing; AudioLLMService warns loudly in that case.
     */
    costPerMinute?: number;
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
    /**
     * € per 1M input tokens billed by the embedding provider, driven by
     * EMBEDDER_INPUT_COST_PER_1M_TOKENS. Embedding providers return vectors
     * only (no usage figures), so EmbedderService counts tokens locally and
     * charges `tokens * rate / 1_000_000` as the cost override. 0 or unset →
     * embeddings are free and no usage record is written.
     */
    inputCostPer1MTokens?: number;
    /**
     * Distributed token-bucket rate limit for the embedder. When present,
     * ModelService.getEmbedder() wraps the provider embedder in a
     * RateLimitedEmbedder backed by a Redis token bucket (shared across all
     * workers) plus a local concurrency gate. Sub-batches the input by
     * estimated tokens, honours provider 429 Retry-After, and refunds the
     * bucket on retry. Optional — when undefined, getEmbedder() returns the
     * raw provider embedder. Driven by EMBEDDER_* env vars.
     */
    rateLimit?: {
      /** Provider tokens-per-minute limit (EMBEDDER_TPM_LIMIT). */
      tpmLimit: number;
      /** Headroom subtracted from tpmLimit to absorb estimation error (EMBEDDER_TPM_SAFETY). */
      safetyTokens: number;
      /** Max estimated tokens per provider call; larger inputs are sub-batched (EMBEDDER_MAX_BATCH_TOKENS). */
      maxBatchTokens: number;
      /** Max concurrent in-flight provider calls across this process (EMBEDDER_MAX_CONCURRENT_REQUESTS). */
      maxConcurrentRequests: number;
      /** Max time to wait for bucket capacity before throwing EmbedderBucketStarvedError (EMBEDDER_MAX_WAIT_MS). */
      maxWaitMs: number;
      /** Max attempts on a 429 before giving up (EMBEDDER_MAX_ATTEMPTS). */
      maxAttempts: number;
      /** Heuristic chars→tokens divisor for the token estimate (EMBEDDER_CHARS_PER_TOKEN). */
      charsPerToken: number;
      /** Redis key suffix for the shared bucket (prefixed with the Redis queue namespace). */
      bucketKey: string;
    };
  };
}
