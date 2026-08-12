import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { encodingForModel, Tiktoken, TiktokenModel } from "js-tiktoken";
import { TOKEN_USAGE_RECORDER, TokenUsageRecorderInterface } from "../../../common/tokens";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { TokenUsageType } from "../../../foundations/tokenusage/enums/tokenusage.type";
import { TokenUsageService } from "../../../foundations/tokenusage/services/tokenusage.service";
import { ModelService } from "../../llm/services/model.service";

/**
 * Opt-in cost attribution for an embedding call. Without both
 * `relationshipId` and `relationshipType` no usage record is written — the
 * package stays domain-agnostic and the caller decides what the usage is
 * billed against.
 */
export interface EmbedderAttribution {
  relationshipId: string;
  relationshipType: string;
  tokenUsageType?: string;
}

/**
 * Ceiling for ONE embedding input. The provider hard cap is 8192 tokens
 * (`400 Invalid 'input[0]': maximum input length is 8192 tokens` from
 * text-embedding-3-large — a real run lost a whole document to it), so this
 * sits below it: the buffer absorbs the chars-per-token fallback heuristic
 * being slightly optimistic for models tiktoken does not know.
 */
const MAX_EMBED_INPUT_TOKENS = 8000;

/** Cut points are snapped to whitespace so slices break between words. */
const WHITESPACE = /\s/;

@Injectable()
export class EmbedderService {
  private readonly logger = new Logger(EmbedderService.name);

  constructor(
    private readonly modelService: ModelService,
    private readonly config: ConfigService<BaseConfigInterface>,
    // Both usage dependencies are @Optional() so consumers that never mount the
    // tokenusage module (and apps that bind no TOKEN_USAGE_RECORDER) keep
    // booting and simply record nothing.
    @Optional() private readonly tokenUsageService?: TokenUsageService,
    @Optional() @Inject(TOKEN_USAGE_RECORDER) private readonly tokenUsageRecorder?: TokenUsageRecorderInterface,
  ) {}

  async vectoriseText(params: { text: string; attribution?: EmbedderAttribution }): Promise<any> {
    try {
      const result = await this.embedGuarded(params.text, params.attribution);
      await this.persistUsage([params.text], params.attribution);
      return result;
    } catch (error) {
      await this.persistUsageOnFailure([params.text], params.attribution, error);
      throw error;
    }
  }

  async vectoriseTextBatch(texts: string[], attribution?: EmbedderAttribution): Promise<any[]> {
    try {
      const sliced = texts.map((text) => this.splitByTokenBudget(text));
      const withinBudget: number[] = [];
      const oversized: number[] = [];
      sliced.forEach((slices, index) => (slices.length === 1 ? withinBudget : oversized).push(index));

      const result: any[] = new Array(texts.length);
      // The texts that fit still travel as ONE provider batch, in input order —
      // batching is why vectoriseTextBatch exists (chunk.repository.ts:405).
      if (withinBudget.length > 0) {
        const vectors = await this.modelService.getEmbedder().embedDocuments(withinBudget.map((index) => texts[index]));
        withinBudget.forEach((index, position) => (result[index] = vectors[position]));
      }
      for (const index of oversized) {
        this.warnOversizedInput(texts[index], sliced[index].length, attribution);
        result[index] = this.meanPool(await this.embedSlices(sliced[index]));
      }

      await this.persistUsage(texts, attribution);
      return result;
    } catch (error) {
      await this.persistUsageOnFailure(texts, attribution, error);
      throw error;
    }
  }

  /**
   * Embeds ONE text, slicing it first when it exceeds the provider's per-input
   * cap: every slice goes through the same (rate-limited) embedder and the
   * slice vectors are mean-pooled, so the caller always gets exactly one vector
   * for one text and no oversized request ever reaches the provider.
   */
  private async embedGuarded(text: string, attribution?: EmbedderAttribution): Promise<number[]> {
    const slices = this.splitByTokenBudget(text);
    if (slices.length === 1) return this.modelService.getEmbedder().embedQuery(text);
    this.warnOversizedInput(text, slices.length, attribution);
    return this.meanPool(await this.embedSlices(slices));
  }

  /**
   * Sequential on purpose: it mirrors RateLimitedEmbedder.embedDocuments, which
   * walks its sub-batches one at a time (rate-limited-embedder.ts:77) so a
   * single large input never raids the shared token bucket in one burst.
   */
  private async embedSlices(slices: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (const slice of slices) vectors.push(await this.modelService.getEmbedder().embedQuery(slice));
    return vectors;
  }

  private warnOversizedInput(text: string, sliceCount: number, attribution?: EmbedderAttribution): void {
    const owner = attribution?.relationshipType
      ? `${attribution.relationshipType} ${attribution.relationshipId}`
      : "unattributed";
    this.logger.warn(
      `Embedding input exceeds ${MAX_EMBED_INPUT_TOKENS} tokens ` +
        `(${this.countText(text)} tokens, ${text.length} chars) — embedding ${sliceCount} slices ` +
        `and mean-pooling [${owner}]`,
    );
  }

  /**
   * Slices `text` into pieces that each measure at most MAX_EMBED_INPUT_TOKENS
   * with the SAME tokenizer used for billing. A text that already fits is
   * returned as-is (single element), and the slices always concatenate back to
   * the original text — nothing is dropped.
   */
  private splitByTokenBudget(text: string): string[] {
    const total = this.countText(text);
    if (total <= MAX_EMBED_INPUT_TOKENS) return [text];

    // One measurement of the whole text yields its chars-per-token density,
    // which is only the FIRST GUESS for each cut; every candidate is then
    // measured, so a denser-than-average stretch cannot produce an oversized
    // slice.
    const charsPerToken = text.length / total;
    const slices: string[] = [];
    let rest = text;
    while (rest.length > 0) {
      if (this.countText(rest) <= MAX_EMBED_INPUT_TOKENS) {
        slices.push(rest);
        break;
      }
      const head = this.takeBudgetedHead(rest, charsPerToken);
      slices.push(head);
      rest = rest.slice(head.length);
    }
    return slices;
  }

  /** Longest measured-within-budget prefix of `text` (never empty). */
  private takeBudgetedHead(text: string, charsPerToken: number): string {
    const guess = Math.floor(MAX_EMBED_INPUT_TOKENS * charsPerToken * 0.95);
    let length = Math.max(1, Math.min(text.length - 1, guess));
    for (;;) {
      const candidate = this.snapToWordBoundary(text, length);
      if (this.countText(candidate) <= MAX_EMBED_INPUT_TOKENS) return candidate;
      const shorter = Math.floor(length * 0.9);
      // Guarantees progress: the caller consumes head.length characters.
      if (shorter < 1) return text.slice(0, 1);
      length = shorter;
    }
  }

  /**
   * Pulls the cut back to the nearest whitespace within the last fifth of the
   * window, so slices break between words. A stretch with no whitespace at all
   * (a long unbroken blob) is cut mid-word rather than left oversized.
   */
  private snapToWordBoundary(text: string, length: number): string {
    if (length >= text.length) return text;
    const earliest = Math.floor(length * 0.8);
    for (let i = length; i > earliest; i--) {
      if (WHITESPACE.test(text[i])) return text.slice(0, i);
    }
    return text.slice(0, length);
  }

  /**
   * Element-wise mean of the slice vectors, L2-normalized: the standard
   * long-input reduction. Normalising keeps the pooled vector comparable with
   * single-call vectors under cosine similarity, which is what every Neo4j
   * vector index in this package searches with.
   */
  private meanPool(vectors: number[][]): number[] {
    const dimensions = vectors[0].length;
    const mean = new Array<number>(dimensions).fill(0);
    for (const vector of vectors) {
      for (let i = 0; i < dimensions; i++) mean[i] += vector[i];
    }
    for (let i = 0; i < dimensions; i++) mean[i] /= vectors.length;
    const norm = Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0));
    // A zero vector (the MOCK_AI embedder returns those) has no direction to normalise.
    return norm > 0 ? mean.map((value) => value / norm) : mean;
  }

  /** Lazily-built tokenizer for the configured embedder model; null after a failed init. */
  private tokenizer: Tiktoken | null | undefined;

  /**
   * Embedding providers return vectors only — no usage figures — so tokens are
   * counted LOCALLY with the embedder model's own tokenizer (js-tiktoken).
   * For OpenAI-family models (text-embedding-3-large on Azure — a360ai's
   * embedder) this count is exactly what the provider bills. Models unknown to
   * tiktoken fall back to the rate limiter's chars-per-token heuristic.
   * One record per service invocation (a batch is one record), attribution
   * opt-in exactly like LLMService.persistUsage, floor-exempt (applyMinimum
   * false): sub-cent embedding calls must never floor to 0.1 credits.
   */
  private async persistUsage(
    texts: string[],
    attribution?: EmbedderAttribution,
    /** Failure path only: a zero-token operation records nothing. See {@link persistUsageOnFailure}. */
    skipWhenZeroTokens = false,
  ): Promise<void> {
    if (!attribution?.relationshipId || !attribution?.relationshipType) return;
    const embedderConfig = this.config.get<ConfigAiInterface>("ai")?.embedder;
    const rate = embedderConfig?.inputCostPer1MTokens ?? 0;
    if (rate <= 0) return;
    const recorder = this.tokenUsageRecorder ?? this.tokenUsageService;
    if (!recorder) return;
    try {
      const tokens = this.countTokens(texts, embedderConfig);
      if (skipWhenZeroTokens && tokens === 0) return;
      await recorder.recordTokenUsage({
        tokens: { input: tokens, output: 0 },
        type: attribution.tokenUsageType ?? TokenUsageType.Embedding,
        relationshipId: attribution.relationshipId,
        relationshipType: attribution.relationshipType,
        applyMinimum: false,
        costOverride: (tokens * rate) / 1_000_000,
      });
    } catch (err) {
      this.logger.warn(`Embedding usage persistence failed — continuing: ${String(err)}`);
    }
  }

  /**
   * Records what a FAILED embedding call already burned — but ONLY when the
   * rejection is evidence the provider actually did work.
   *
   * A failure is not automatically a free call: a batch that dies on the
   * provider's LAST internal sub-batch has still been charged for every chunk
   * the provider served, and `RateLimitedEmbedder` surfaces that as a single
   * rejection. Recording nothing there understates real spend.
   *
   * BUT the counts here are computed LOCALLY with tiktoken, never read off a
   * provider response, so they exist even when the provider was never reached.
   * Billing every rejection would therefore charge the customer for OUR
   * outages, inverting the very rule this path claims parity with:
   * `LLMService.persistUsageOnFailure` bills provider-REPORTED tokens, which
   * are 0 when nothing was served. The damage would be real —
   * `RateLimitedEmbedder` rejects with `EmbedderBucketStarvedError` before any
   * HTTP request when our own token bucket cannot grant within `maxWaitMs`, and
   * these calls sit inside BullMQ jobs with `attempts: 3`, so one transient
   * local failure could bill the same batch up to four times.
   *
   * So the local count is only trusted when {@link providerServedWork} says the
   * rejection carries positive evidence of provider-side work. See that method
   * for the signal and for the residual over-billing it knowingly accepts.
   *
   * ZERO-TOKEN RULE, as everywhere else on this path: an operation that burned
   * nothing records NOTHING — a 0-token row would assert a call that never
   * happened.
   *
   * Never throws: it sits in a catch block and must not mask the original error.
   */
  private async persistUsageOnFailure(
    texts: string[],
    attribution?: EmbedderAttribution,
    error?: unknown,
  ): Promise<void> {
    if (!this.providerServedWork(error)) return;
    await this.persistUsage(texts, attribution, true);
  }

  /**
   * Does this rejection carry positive evidence that the provider did billable
   * work? Nothing is billed unless it does.
   *
   * THE SIGNAL: a SERVER-side HTTP status (5xx) reported by the provider. That
   * is the only class of rejection in which the provider accepted the request
   * and failed during or after processing it — the case the failure-billing
   * exists for (a multi-sub-batch call whose last sub-batch 500s, after earlier
   * sub-batches were served and charged).
   *
   * Everything else records NOTHING, because in every other case the provider
   * demonstrably served none of this input:
   *  - NO status at all — raised locally before or without any HTTP exchange:
   *    `EmbedderBucketStarvedError` (our own bucket refusing to grant), DNS
   *    failures, connection refused, aborts and client-side timeouts. This is
   *    the "our outage must not charge the customer" case.
   *  - A 4xx — the provider REFUSED the request rather than serving it: 401/403
   *    auth, 400/422 malformed, 413 too large, 429 rate-limited (including the
   *    retry-exhausted path). Providers do not charge for a request they
   *    rejected, so neither do we.
   *
   * RESIDUAL OVER-BILLING, KNOWINGLY ACCEPTED: on a 5xx this bills the WHOLE
   * submitted input, including sub-batches the provider never got to.
   * `RateLimitedEmbedder.embedDocuments` splits the input into sequential
   * sub-batches and is all-or-nothing to its caller — it returns vectors or it
   * throws, never a partial result — so this service cannot know how many
   * sub-batches were served. Over-billing is bounded by the batch size and only
   * on provider-side faults; the alternative (recording nothing) silently
   * under-bills every genuinely-served chunk. Narrowing this needs
   * `RateLimitedEmbedder` to report served-sub-batch counts, which would change
   * its published surface.
   */
  private providerServedWork(error?: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
    const status = candidate.status ?? candidate.statusCode ?? candidate.response?.status;
    return typeof status === "number" && status >= 500 && status <= 599;
  }

  /**
   * Token count for a SINGLE text, through the very tokenizer billing uses — so
   * the oversize guard slices by the same measure the provider charges by.
   */
  private countText(text: string): number {
    return this.countTokens([text], this.config.get<ConfigAiInterface>("ai")?.embedder);
  }

  private countTokens(texts: string[], embedderConfig: ConfigAiInterface["embedder"]): number {
    if (this.tokenizer === undefined) {
      // Try the raw model name, then the provider-prefixed form normalised
      // ("azure/openai/text-embedding-3-large@francecentral" → "text-embedding-3-large").
      const raw = embedderConfig?.model ?? "";
      const normalised = raw.split("/").pop()?.split("@")[0] ?? raw;
      this.tokenizer = null;
      for (const candidate of [raw, normalised]) {
        try {
          this.tokenizer = encodingForModel(candidate as TiktokenModel);
          break;
        } catch {
          /* not a tiktoken model — try next candidate, else heuristic fallback */
        }
      }
    }
    if (this.tokenizer) {
      return texts.reduce((sum, t) => sum + this.tokenizer!.encode(t).length, 0);
    }
    const charsPerToken = embedderConfig?.rateLimit?.charsPerToken || 4;
    return texts.reduce((sum, t) => sum + Math.ceil(t.length / charsPerToken), 0);
  }
}
