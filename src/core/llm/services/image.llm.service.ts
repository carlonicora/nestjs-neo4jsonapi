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
  /**
   * e.g. "1:1", "16:9". Chat-completions providers receive it as
   * `image_config.aspect_ratio`; Venice receives it as `aspect_ratio`, and only
   * when the connection pins no explicit width/height (a pixel-based Venice
   * model takes dimensions, not a ratio).
   */
  aspectRatio?: string;
  /**
   * Venice only. Per-call overrides of the connection's own defaults — a caller
   * that passes none produces exactly the connection-configured request.
   */
  negativePrompt?: string;
  width?: number;
  height?: number;
  /** Reproducibility control. Omitted when unset, so Venice picks a seed. */
  seed?: number;
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
 * Minimal shape of a Venice `POST /image/generate` response. `images` holds RAW
 * base64 payloads — no `data:` prefix — which is why the Venice path
 * re-assembles the data URL this service's contract promises.
 */
interface VeniceImageResponse {
  id?: string;
  images?: unknown;
  error?: unknown;
}

/** Venice `format` values, and the MIME type each one produces. */
const VENICE_FORMAT_MIME: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Venice's own default when the request sends no `format`. */
const VENICE_DEFAULT_FORMAT = "webp";

/**
 * Image GENERATION service (the counterpart of `VisionLLMService`, which
 * ANALYSES images).
 *
 * Deliberately a plain `@Injectable()` over `fetch` rather than a LangChain
 * model: image output is not part of the LangChain chat surface. This mirrors
 * the direct HTTP path `AudioLLMService` already uses for transcription.
 *
 * TWO wire protocols, chosen by the serving connection's `provider`:
 *   - `venice` — Venice's native `POST {url}/image/generate`: a top-level
 *     prompt plus top-level generation knobs, answered with
 *     `{ images: [<raw base64>] }`, no usage block, and moderation reported in
 *     the `x-venice-*` response headers.
 *   - everything else — the OpenRouter chat-completions contract:
 *     `modalities: ["image","text"]` plus an optional `image_config`, with the
 *     image handed back as a data URL at
 *     `choices[0].message.images[0].image_url.url`.
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

  /** Is this connection served by Venice's native image protocol? */
  private isVenice(candidate: ResolvedAiCandidate): boolean {
    return candidate.provider === "venice";
  }

  /**
   * Resolves a candidate's base URL into a full endpoint.
   *
   * The connection stores a BASE url (`https://api.venice.ai/api/v1`) and each
   * protocol appends its own path — but an operator may equally have configured
   * the full endpoint, or a gateway that exposes it somewhere else entirely.
   * Both are honoured: a url that already ends in `path` is used verbatim, so
   * the endpoint stays configurable without a second config field.
   */
  private endpointFor(candidate: ResolvedAiCandidate, path: string): string {
    const base = candidate.url.replace(/\/+$/, "");
    return base.endsWith(path) ? base : `${base}${path}`;
  }

  /**
   * POSTs a JSON body and returns the parsed response, or throws with the
   * upstream status and body so `withRetry` can recognise a 429.
   */
  private async postJson<T>(params: {
    endpoint: string;
    apiKey: string;
    body: unknown;
  }): Promise<{ json: T; headers: Headers }> {
    const response = await this.withTimeout(
      fetch(params.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // A `custom` connection may point at an unauthenticated endpoint.
          ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
        },
        body: JSON.stringify(params.body),
      }),
      this.CALL_TIMEOUT_MS,
      "Image LLM call",
    );

    if (!response.ok) {
      const bodyText = (await response.text().catch(() => "")).slice(0, 500);
      this.logger.error(`image-generation: UPSTREAM ERROR — status=${response.status} body=${bodyText}`);
      throw new Error(`HTTP ${response.status} — ${bodyText}`);
    }

    return { json: (await response.json().catch(() => ({}))) as T, headers: response.headers };
  }

  /** One chat-completions round-trip (OpenRouter and OpenAI-compatible kin). */
  private async callCandidate(
    candidate: ResolvedAiCandidate,
    params: ImageGenerationParams,
  ): Promise<ImageChatCompletionResponse> {
    // OpenRouter-documented image-output body: `modalities` opts the response
    // into image parts, `image_config` carries provider-specific generation
    // options (aspect_ratio among them) and is omitted entirely when unset.
    const body = {
      model: candidate.model,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: params.prompt }],
      ...(params.aspectRatio ? { image_config: { aspect_ratio: params.aspectRatio } } : {}),
    };

    const { json } = await this.postJson<ImageChatCompletionResponse>({
      endpoint: this.endpointFor(candidate, "/chat/completions"),
      apiKey: candidate.apiKey,
      body,
    });
    return json;
  }

  /**
   * Turns a chat-completions response into the service's result shape.
   *
   * @throws {ContentModerationError} when the refusal names a safety reason.
   */
  private parseChatCompletionsResult(json: ImageChatCompletionResponse): Omit<ImageGenerationResult, "rates"> {
    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (typeof url !== "string" || url.length === 0) {
      // A refusal comes back as a 200 with text instead of an image, so the
      // moderation check belongs here rather than on the HTTP error path.
      const content = json.choices?.[0]?.message?.content;
      this.throwForRefusal(`${typeof content === "string" ? content : ""} ${JSON.stringify(json.error ?? "")}`, json);
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

  /**
   * One Venice `POST {url}/image/generate` round-trip.
   *
   * A DIFFERENT protocol from the chat-completions path above, not a dialect of
   * it: the prompt is a top-level string, the generation knobs are top-level
   * fields, and the answer is `{ images: [<raw base64>] }` with no usage block.
   * Every optional field is omitted when unset so the Venice server default
   * applies — sending `width: undefined` and sending nothing are the same on the
   * wire, but sending an explicit `safe_mode: false` is NOT the same as sending
   * nothing, which is why the config reads booleans as a tri-state.
   */
  private async callVeniceCandidate(
    candidate: ResolvedAiCandidate,
    params: ImageGenerationParams,
  ): Promise<{ json: VeniceImageResponse; headers: Headers }> {
    const width = params.width ?? candidate.width;
    const height = params.height ?? candidate.height;
    const negativePrompt = params.negativePrompt ?? candidate.negativePrompt;

    const body = {
      model: candidate.model,
      prompt: params.prompt,
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      // A pixel-based model takes width/height and IGNORES the ratio; a
      // ratio-based one takes the ratio. Explicit dimensions therefore win, and
      // the caller's aspect ratio only reaches Venice when none are configured.
      ...(width === undefined && height === undefined && params.aspectRatio
        ? { aspect_ratio: params.aspectRatio }
        : {}),
      ...(candidate.steps !== undefined ? { steps: candidate.steps } : {}),
      ...(candidate.cfgScale !== undefined ? { cfg_scale: candidate.cfgScale } : {}),
      ...(candidate.safeMode !== undefined ? { safe_mode: candidate.safeMode } : {}),
      ...(candidate.hideWatermark !== undefined ? { hide_watermark: candidate.hideWatermark } : {}),
      ...(candidate.imageFormat ? { format: candidate.imageFormat } : {}),
      ...(params.seed !== undefined ? { seed: params.seed } : {}),
    };

    return this.postJson<VeniceImageResponse>({
      endpoint: this.endpointFor(candidate, "/image/generate"),
      apiKey: candidate.apiKey,
      body,
    });
  }

  /**
   * Turns a Venice response into the service's result shape.
   *
   * Venice answers RAW base64, so the `data:` prefix this service's contract
   * promises is re-assembled here from the `format` the request asked for —
   * there is nothing in the body to read it back from.
   *
   * Venice reports no usage at all, so token counts are zero and the cost comes
   * from the connection's flat `costPerImage`. A refusal is a 200 whose
   * `x-venice-is-content-violation` header is "true"; a blur is the softer
   * `x-venice-is-blurred`, which returns an image and is only logged.
   */
  private parseVeniceResult(
    json: VeniceImageResponse,
    headers: Headers,
    candidate: ResolvedAiCandidate,
  ): Omit<ImageGenerationResult, "rates"> {
    if (headers.get("x-venice-is-content-violation") === "true") {
      throw new ContentModerationError(
        "Image generation was blocked by content moderation (Venice reported a content violation).",
      );
    }

    const base64 = Array.isArray(json.images) ? json.images[0] : undefined;
    if (typeof base64 !== "string" || base64.length === 0) {
      this.throwForRefusal(JSON.stringify(json.error ?? ""), json);
    }

    if (headers.get("x-venice-is-blurred") === "true") {
      this.logger.warn("image-generation: Venice returned a BLURRED image — safe_mode is on for this connection");
    }

    const format = (candidate.imageFormat || VENICE_DEFAULT_FORMAT).toLowerCase();
    const mimeType = VENICE_FORMAT_MIME[format] ?? `image/${format}`;

    return {
      imageBase64: `data:${mimeType};base64,${base64}`,
      mimeType,
      // Venice bills per image and reports no usage block, so there is nothing
      // honest to put here. `costPerImage` is what actually prices the call.
      tokenUsage: { input: 0, output: 0 },
      cost:
        typeof candidate.costPerImage === "number" && Number.isFinite(candidate.costPerImage)
          ? candidate.costPerImage
          : undefined,
    };
  }

  /**
   * Fails a response that carried no image, as a moderation error when the text
   * names a safety reason and as a plain error otherwise.
   *
   * @throws always — the `never` return lets callers treat a call to this as an
   *   exit, so the value they were parsing narrows to non-undefined afterwards.
   */
  private throwForRefusal(haystack: string, json: unknown): never {
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

  /**
   * Generates ONE image from a text prompt.
   *
   * The wire protocol is chosen by the SERVING connection's provider, so one
   * chain may mix a Venice link with an OpenRouter one and each is called the
   * way it expects.
   *
   * @param params.prompt - The full image prompt.
   * @param params.aspectRatio - Optional aspect ratio (e.g. "16:9"). Sent as
   *   `image_config.aspect_ratio` on chat-completions providers, and as
   *   `aspect_ratio` on Venice — there only when the connection pins no explicit
   *   width/height. Omitted when unset so the provider default applies.
   * @param params.negativePrompt - Venice only; overrides the connection default.
   * @param params.width - Venice only; overrides the connection default.
   * @param params.height - Venice only; overrides the connection default.
   * @param params.seed - Venice only; omitted when unset so Venice picks one.
   * @returns The image as a data URL, its MIME type, token usage, the cost when
   *   the provider reports one (or the connection's flat per-image price), and
   *   the serving connection's rates.
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
    const parsed = await this.withRetry(
      async (attempt) => {
        serving = candidateAt(attempt);
        if (this.isVenice(serving)) {
          const { json, headers } = await this.callVeniceCandidate(serving, params);
          return this.parseVeniceResult(json, headers, serving);
        }
        return this.parseChatCompletionsResult(await this.callCandidate(serving, params));
      },
      // Cooldown the rate-limited connection so the NEXT attempt (and the next
      // request) resolves past it. Best-effort by contract: notify never throws.
      (attempt) => this.modelService.notifyCandidateFailure(candidateAt(attempt)),
    );

    return { ...parsed, rates: this.ratesOf(serving) };
  }
}
