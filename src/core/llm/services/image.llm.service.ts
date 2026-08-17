import { Injectable, Logger } from "@nestjs/common";
import { TokenUsageRatesInterface } from "../../../foundations/tokenusage/services/tokenusage.service";
import { AiConnectionType, ResolvedAiCandidate } from "../interfaces/ai-candidate.interface";
import { ModelService } from "./model.service";
import { ContentModerationError } from "./vision.llm.service";

const IMAGE_CONNECTION_TYPE: AiConnectionType = "image";

/**
 * Result of one image GENERATION call.
 *
 * `imageBase64` is the FULL data URL (`data:image/png;base64,…`) exactly as the
 * provider returned it, so a caller can render it directly or decode it for
 * upload without having to re-assemble the prefix.
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
  /**
   * Per-1M-token rates of the CONNECTION THAT SERVED THE CALL — a DB-configured
   * AiConnection of type "image", or the IMAGE_* env block as the final link of
   * the chain. Fallback pricing only (used when `cost` is absent). Undefined
   * when the serving connection declares no rates, so the caller can tell
   * "no rates configured" apart from "rates of zero".
   */
  rates?: TokenUsageRatesInterface;
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
 * Configuration resolves through the "image" AI-connection chain
 * (`ModelService.getCandidatesForType`): database-configured `AiConnection`
 * nodes first (per-company, then global, administered from the AI-connections
 * page), with the IMAGE_* env block as the final link. There is deliberately
 * NO fallback onto the AI_* chat configuration — image generation defines its
 * own provider, key, endpoint and pricing. A rate-limited attempt cools the
 * failing connection down and retries against the next link of the chain.
 */
@Injectable()
export class ImageLLMService {
  private readonly logger = new Logger(ImageLLMService.name);

  private readonly MAX_RETRIES = 5;
  private readonly INITIAL_DELAY_MS = 1000;
  private readonly CALL_TIMEOUT_MS = 120000; // 120 second timeout for image generation calls

  constructor(private readonly modelService: ModelService) {}

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
   * `fn` receives the ATTEMPT INDEX so each retry can address the next link of
   * the image connection chain (mirrors `VisionLLMService.withRetry`); a chain
   * of one simply re-targets the same connection. `onRateLimited` fires before
   * every backoff — including the final attempt — so the failing connection's
   * cooldown outlives this call.
   */
  private async withRetry<T>(
    fn: (attempt: number) => Promise<T>,
    onRateLimited: (attempt: number) => void,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        return await fn(attempt);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.isRateLimitError(error)) onRateLimited(attempt);

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

  /** The serving connection's rates, or undefined when it declares none. */
  private ratesOf(candidate: ResolvedAiCandidate): TokenUsageRatesInterface | undefined {
    if (candidate.inputCostPer1MTokens === undefined && candidate.outputCostPer1MTokens === undefined) {
      return undefined;
    }
    return {
      inputCostPer1MTokens: candidate.inputCostPer1MTokens,
      outputCostPer1MTokens: candidate.outputCostPer1MTokens,
    };
  }

  /** One provider round-trip against one connection of the chain. */
  private async callCandidate(
    candidate: ResolvedAiCandidate,
    params: ImageGenerationParams,
  ): Promise<ImageChatCompletionResponse> {
    const endpoint = `${candidate.url.replace(/\/+$/, "")}/chat/completions`;

    // OpenRouter-documented image-output body: `modalities` opts the response
    // into image parts, `image_config` carries provider-specific generation
    // options (aspect_ratio among them) and is omitted entirely when unset.
    const body = {
      model: candidate.model,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: params.prompt }],
      ...(params.aspectRatio ? { image_config: { aspect_ratio: params.aspectRatio } } : {}),
    };

    const response = await this.withTimeout(
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // A `custom` connection may point at an unauthenticated endpoint.
          ...(candidate.apiKey ? { Authorization: `Bearer ${candidate.apiKey}` } : {}),
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
  }

  /**
   * Generates ONE image from a text prompt.
   *
   * @param params.prompt - The full image prompt.
   * @param params.aspectRatio - Optional aspect ratio (e.g. "16:9"), sent as
   *   `image_config.aspect_ratio`. Omitted from the body when unset so the
   *   provider default applies.
   * @returns The image as a data URL, its MIME type, token usage, the
   *   provider-reported cost when available, and the serving connection's rates.
   * @throws {Error} If no image connection is configured, the endpoint fails,
   *   or no image comes back.
   * @throws {ContentModerationError} If the provider refused on safety grounds.
   */
  async generate(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    // DB-configured connections first (company chain, then global), the
    // IMAGE_* env block last. A candidate without a model or url cannot serve
    // an image call and is skipped — with an empty IMAGE_* block that is
    // exactly the bare env placeholder the resolver always appends.
    const candidates = this.modelService
      .getCandidatesForType(IMAGE_CONNECTION_TYPE)
      .filter((candidate) => candidate.model && candidate.url);

    if (candidates.length === 0) {
      throw new Error(
        'Image generation is not configured: define an AI connection of type "image" in Administration, ' +
          "or set IMAGE_PROVIDER, IMAGE_MODEL, IMAGE_URL and IMAGE_API_KEY. " +
          "Image generation deliberately does not fall back to the AI_* chat configuration.",
      );
    }

    // Out-of-range attempts clamp to the last link, mirroring
    // ModelService.pickCandidate: a retry loop that outruns the chain keeps
    // addressing the final connection instead of crashing.
    const candidateAt = (attempt: number) => candidates[Math.min(attempt, candidates.length - 1)];

    let serving: ResolvedAiCandidate = candidateAt(0);
    const json = await this.withRetry(
      (attempt) => {
        serving = candidateAt(attempt);
        return this.callCandidate(serving, params);
      },
      // Cooldown the rate-limited connection so the NEXT attempt (and the next
      // request) resolves past it. Best-effort by contract: notify never throws.
      (attempt) => this.modelService.notifyCandidateFailure(candidateAt(attempt)),
    );

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
      rates: this.ratesOf(serving),
    };
  }
}
