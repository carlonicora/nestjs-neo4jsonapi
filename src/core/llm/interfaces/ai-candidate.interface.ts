export const AI_CONNECTION_TYPES = [
  "ai",
  "aiLite",
  "aiLarge",
  "vision",
  "audio",
  "image",
  "embedder",
  "transcriber",
  "documentAi",
] as const;
export type AiConnectionType = (typeof AI_CONNECTION_TYPES)[number];

export const AI_CONNECTIONS_CHANGED_EVENT = "ai-connections.changed";

/** One link in a fallback chain, normalized to the shape buildChatModel consumes. */
export interface ResolvedAiCandidate {
  source: "db" | "env";
  /** AiConnection node id, or `env:<type>` for the final .env candidate. */
  connectionId: string;
  connectionType: AiConnectionType;
  provider: string;
  apiKey: string;
  model: string;
  url: string;
  region?: string;
  instance?: string;
  /**
   * IGNORED by the azure chat branch (`ModelService.buildChatModel`'s `case
   * "azure"`) — that branch speaks the GA v1 Responses surface, which is
   * IMPLICITLY versioned, so no `api-version` is ever sent. Still read by
   * azure EMBEDDINGS (`AzureOpenAIEmbeddings`) and the TRANSCRIBER
   * (`AzureOpenAI` SDK client), which are unaffected by the Responses move.
   */
  apiVersion?: string;
  googleCredentialsBase64?: string;
  allowFallbacks?: boolean;
  reasoningEffort?: string;
  maxOutputTokens?: number;
  dimensions?: number;
  inputCostPer1MTokens?: number;
  outputCostPer1MTokens?: number;
  cachedInputCostPer1MTokens?: number;
  costPerMinute?: number;
  costPerPage?: number;
  /**
   * Flat price of ONE generated image, in the same currency as every other rate
   * in this config. Venice (and every other per-image biller) reports no token
   * usage at all, so `ImageLLMService` charges this as the request's cost
   * override — the per-1M-token rates cannot express a per-image price.
   */
  costPerImage?: number;
  directUrl?: string;
  language?: string;
  directFormat?: string;
  directProvider?: string;

  // --- Venice image generation (`/image/generate`) -------------------------
  // Connection-level defaults for the native Venice image body. Each one is
  // omitted from the request when unset, so the Venice server default applies.
  /** `negative_prompt` — what the image must NOT contain. */
  negativePrompt?: string;
  /** `width` in pixels (pixel-based models; 1-1280). */
  width?: number;
  /** `height` in pixels (pixel-based models; 1-1280). */
  height?: number;
  /** `steps` — diffusion steps. */
  steps?: number;
  /** `cfg_scale` — prompt adherence strength (0-20). */
  cfgScale?: number;
  /** `safe_mode` — when true Venice blurs adult content. */
  safeMode?: boolean;
  /** `hide_watermark` — suppress the Venice watermark. */
  hideWatermark?: boolean;
  /** `format` — "png" | "jpeg" | "webp". Decides the returned data URL's MIME type. */
  imageFormat?: string;
}
