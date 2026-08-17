import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { TokenUsageRatesInterface } from "../../../foundations/tokenusage/services/tokenusage.service";
import { ContentModerationError } from "./vision.llm.service";

/**
 * Result of one image GENERATION call.
 *
 * `imageBase64` is the FULL data URL (`data:image/png;base64,…`) exactly as the
 * provider returned it, so a caller can drop it straight into an `<img src>` or
 * decode it for upload without having to re-assemble the prefix.
 */
export interface ImageGenerationResult {
  /** Full data URL, e.g. "data:image/png;base64,…" */
  imageBase64: string;
  /** MIME type parsed out of the data URL prefix, e.g. "image/png" */
  mimeType: string;
  tokenUsage: { input: number; output: number };
  /**
   * What the provider ACTUALLY charged for this request (OpenRouter usage
   * accounting: `usage.cost`, in USD credits). Preferred over token-based
   * pricing because image models bill output image tokens at a different rate
   * than output text tokens, and both arrive lumped into `completion_tokens`.
   * Undefined when the provider does not report a cost.
   */
  cost?: number;
}

/** Parameters for an image generation call. */
interface ImageGenerationParams {
  prompt: string;
  /** e.g. "1:1", "16:9". Forwarded as `image_config.aspect_ratio`. */
  aspectRatio?: string;
}

/**
 * Minimal shape of the OpenRouter-style chat-completions response when
 * `modalities` includes `"image"`. Everything is optional because the parsing
 * path must fail with a clear message, never with a TypeError.
 */
interface ImageChatCompletionResponse {
  choices?: {
    message?: {
      content?: unknown;
      images?: { image_url?: { url?: unknown } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: unknown;
}

/**
 * Image GENERATION service (the counterpart of `VisionLLMService`, which
 * ANALYSES images).
 *
 * Deliberately a plain `@Injectable()` over `fetch` rather than a LangChain
 * model: image output is not part of the LangChain chat surface, and the
 * OpenRouter contract is a single documented chat-completions body —
 * `modalities: ["image","text"]` plus an optional `image_config`, with the
 * image handed back as a data URL at
 * `choices[0].message.images[0].image_url.url`. This mirrors the direct HTTP
 * path `AudioLLMService` already uses for transcription.
 *
 * There is no candidate/failover chain here (unlike vision): image generation
 * is driven by a single dedicated `ai.image` config block, so a rate-limited
 * attempt is simply retried with exponential backoff against the same endpoint.
 */
@Injectable()
export class ImageLLMService {
  private readonly logger = new Logger(ImageLLMService.name);

  private readonly MAX_RETRIES = 5;
  private readonly INITIAL_DELAY_MS = 1000;
  private readonly CALL_TIMEOUT_MS = 120000; // 120 second timeout for image generation calls

  constructor(private readonly config: ConfigService<BaseConfigInterface>) {}

  /**
   * Checks if an error is a rate limit (429) error
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("429") ||
        message.includes("rate limit") ||
        message.includes("resource exhausted") ||
        message.includes("too many requests")
      );
    }
    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Wrap a promise with a timeout
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)),
    ]);
  }

  /**
   * Execute a function with exponential backoff retry on rate limit errors.
   *
   * No candidate-failover bookkeeping (see the class doc): image generation has
   * a single configured endpoint, so every attempt targets the same connection.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.isRateLimitError(error) || attempt === this.MAX_RETRIES - 1) {
          throw lastError;
        }

        // Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s + random 0-500ms
        const baseDelay = this.INITIAL_DELAY_MS * Math.pow(2, attempt);
        const jitter = Math.random() * 500;
        const delay = baseDelay + jitter;

        await this.sleep(delay);
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }

  /**
   * Per-1M-token rates for the image connection, so the caller can price the
   * generation through the standard TokenUsage path.
   */
  getRates(): TokenUsageRatesInterface {
    const image = this.config.get<ConfigAiInterface>("ai").image;
    return {
      inputCostPer1MTokens: image.inputCostPer1MTokens,
      outputCostPer1MTokens: image.outputCostPer1MTokens,
    };
  }

  /**
   * Generates ONE image from a text prompt.
   *
   * @param params.prompt - The full image prompt.
   * @param params.aspectRatio - Optional aspect ratio (e.g. "16:9"), sent as
   *   `image_config.aspect_ratio`. Omitted from the body when unset so the
   *   provider default applies.
   * @returns The image as a data URL, its MIME type, and token usage.
   * @throws {Error} If the image config is incomplete, the endpoint fails, or
   *   no image comes back.
   * @throws {ContentModerationError} If the provider refused on safety grounds.
   */
  async generate(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    const image = this.config.get<ConfigAiInterface>("ai").image;

    const missing: string[] = [];
    if (!image?.model) missing.push("IMAGE_MODEL");
    if (!image?.apiKey) missing.push("IMAGE_API_KEY (or AI_API_KEY)");
    if (!image?.url) missing.push("IMAGE_URL (or AI_URL)");
    if (missing.length > 0) {
      throw new Error(`Image generation is not configured: missing ${missing.join(", ")}`);
    }

    const endpoint = `${image.url.replace(/\/+$/, "")}/chat/completions`;

    // OpenRouter-documented image-output body: `modalities` opts the response
    // into image parts, `image_config` carries provider-specific generation
    // options (aspect_ratio among them) and is omitted entirely when unset.
    const body = {
      model: image.model,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: params.prompt }],
      ...(params.aspectRatio ? { image_config: { aspect_ratio: params.aspectRatio } } : {}),
    };

    const json = await this.withRetry(async () => {
      const response = await this.withTimeout(
        fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${image.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        this.CALL_TIMEOUT_MS,
        "Image LLM call",
      );

      if (!response.ok) {
        const bodyText = (await response.text().catch(() => "")).slice(0, 500);
        this.logger.error(`image-generation: UPSTREAM ERROR — status=${response.status} body=${bodyText}`);
        throw new Error(`HTTP ${response.status} — ${bodyText}`);
      }

      return (await response.json().catch(() => ({}))) as ImageChatCompletionResponse;
    });

    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (typeof url !== "string" || url.length === 0) {
      // A refusal comes back as a 200 with text instead of an image, so the
      // moderation check belongs here rather than on the HTTP error path.
      const content = json.choices?.[0]?.message?.content;
      const haystack = `${typeof content === "string" ? content : ""} ${JSON.stringify(json.error ?? "")}`;
      if (
        haystack.includes("SAFETY") ||
        haystack.includes("blocked") ||
        haystack.includes("content policy") ||
        haystack.includes("HARM_CATEGORY")
      ) {
        throw new ContentModerationError(
          `Image generation was blocked by content moderation. Provider response: ${haystack.slice(0, 500)}`,
        );
      }

      throw new Error(`Image generation returned no image. Provider response: ${JSON.stringify(json).slice(0, 500)}`);
    }

    // Data URL prefix is `data:<mime>;base64,` — anything else means the
    // provider handed back a remote URL, which this contract does not support.
    const mimeMatch = url.match(/^data:([^;,]+);base64,/);
    if (!mimeMatch) {
      throw new Error("Image generation returned an unexpected image payload (expected a base64 data URL)");
    }

    return {
      imageBase64: url,
      mimeType: mimeMatch[1],
      tokenUsage: {
        input: json.usage?.prompt_tokens ?? 0,
        output: json.usage?.completion_tokens ?? 0,
      },
      // OpenRouter always reports the actual charge; other providers may not.
      // Guarded to a finite number so a malformed value degrades to token-based
      // pricing instead of poisoning the caller's cost override.
      cost: typeof json.usage?.cost === "number" && Number.isFinite(json.usage.cost) ? json.usage.cost : undefined,
    };
  }
}
