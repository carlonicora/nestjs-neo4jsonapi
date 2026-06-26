import { Embeddings } from "@langchain/core/embeddings";
import { ConfigAiInterface } from "../../../config/interfaces";
import { AppLoggingService } from "../../logging/services/logging.service";
import { EmbedderTokenBucketService } from "./embedder-token-bucket.service";

type RateLimitConfig = NonNullable<ConfigAiInterface["embedder"]["rateLimit"]>;

// Caps how many embedding requests hit the provider at once across all jobs sharing
// this (singleton) embedder, set via EMBEDDER_MAX_CONCURRENT_REQUESTS (rateLimit config).
// Firing many requests concurrently just queues them server-side and inflates per-call
// latency; a small concurrency keeps calls fast without lowering overall throughput.
class Semaphore {
  private slots: number;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    this.slots = max;
  }

  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.slots++;
  }
}

export class EmbedderBucketStarvedError extends Error {
  constructor(
    public readonly estTokens: number,
    public readonly waitMs: number,
  ) {
    super(`Embedder rate-limit bucket starved: requested=${estTokens} waitMs=${waitMs}`);
    this.name = "EmbedderBucketStarvedError";
  }
}

export class RateLimitedEmbedder extends Embeddings {
  private readonly embedGate: Semaphore;

  constructor(
    private readonly inner: Embeddings,
    private readonly bucket: EmbedderTokenBucketService,
    private readonly rateLimit: RateLimitConfig,
    private readonly logger: AppLoggingService,
  ) {
    super({});
    this.embedGate = new Semaphore(this.rateLimit.maxConcurrentRequests);
  }

  async embedQuery(text: string): Promise<number[]> {
    const [result] = await this.embedDocuments([text]);
    return result;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const estPerText = texts.map((t) => this.estimateTokens(t));
    const subBatches = this.splitIntoSubBatches(texts, estPerText, this.rateLimit.maxBatchTokens);

    if (subBatches.length > 1) {
      const totalTokens = estPerText.reduce((a, b) => a + b, 0);
      this.logger.log("embedder.batch_split", undefined, {
        totalTokens,
        subBatchCount: subBatches.length,
        subBatchSizes: subBatches.map((sb) => sb.estTokens),
      });
    }

    const results: number[][] = new Array(texts.length);
    for (const sb of subBatches) {
      const vectors = await this.embedSubBatchWithRetry(sb.texts, sb.estTokens);
      for (let i = 0; i < sb.indices.length; i++) results[sb.indices[i]] = vectors[i];
    }
    return results;
  }

  private async embedSubBatchWithRetry(subBatch: string[], estTokens: number): Promise<number[][]> {
    let attempt = 0;
    while (true) {
      attempt++;
      const consumeResult = await this.bucket.consume(estTokens, this.rateLimit.maxWaitMs);
      if (!consumeResult.granted) throw new EmbedderBucketStarvedError(estTokens, consumeResult.waitMs);

      const t0 = Date.now();
      try {
        const result = await this.gatedEmbed(subBatch);
        const lastCallMs = Date.now() - t0;
        this.logger.debug("embedder.success", undefined, {
          tokensConsumed: estTokens,
          responseTimeMs: lastCallMs,
        });
        return result;
      } catch (e) {
        if (this.isTokenLimitError(e)) {
          this.logger.warn("embedder.token_limit", undefined, {
            textCount: subBatch.length,
            fallbackPath: "caller",
          });
          throw e;
        }
        if (this.is429(e) && attempt < this.rateLimit.maxAttempts) {
          const retryAfterMs = this.parseRetryAfter(e) ?? 60_000;
          this.logger.warn("embedder.429", undefined, { retryAfterMs, batchTokens: estTokens, attempt });
          await this.bucket.refund(estTokens);
          await this.sleep(retryAfterMs);
          continue;
        }
        if (this.is429(e)) {
          this.logger.error("embedder.429_exhausted", undefined, undefined, {
            finalAttempt: attempt,
            batchTokens: estTokens,
          });
          throw e;
        }
        throw e;
      }
    }
  }

  // Acquire a concurrency slot for the duration of the actual provider call only; retry
  // backoff (in the caller) happens outside the gate so a sleeping retry never holds a slot.
  private async gatedEmbed(texts: string[]): Promise<number[][]> {
    await this.embedGate.acquire();
    try {
      return await this.inner.embedDocuments(texts);
    } finally {
      this.embedGate.release();
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / this.rateLimit.charsPerToken);
  }

  private splitIntoSubBatches(
    texts: string[],
    estPerText: number[],
    cap: number,
  ): { texts: string[]; indices: number[]; estTokens: number }[] {
    const subBatches: { texts: string[]; indices: number[]; estTokens: number }[] = [];
    let current = { texts: [] as string[], indices: [] as number[], estTokens: 0 };
    for (let i = 0; i < texts.length; i++) {
      const tokens = estPerText[i];
      if (current.estTokens + tokens > cap && current.texts.length > 0) {
        subBatches.push(current);
        current = { texts: [], indices: [], estTokens: 0 };
      }
      current.texts.push(texts[i]);
      current.indices.push(i);
      current.estTokens += tokens;
    }
    if (current.texts.length > 0) subBatches.push(current);
    return subBatches;
  }

  private is429(e: unknown): boolean {
    if (!e) return false;
    const status = (e as { status?: number }).status ?? (e as { statusCode?: number }).statusCode;
    if (status === 429) return true;
    const msg = e instanceof Error ? e.message : String(e);
    return /rate.?limit/i.test(msg) && /tokens?\s*per\s*min/i.test(msg);
  }

  private isTokenLimitError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return /maximum context length/i.test(msg) || /token\s*limit/i.test(msg);
  }

  private parseRetryAfter(e: unknown): number | null {
    const headers = (
      e as {
        response?: { headers?: { get?: (k: string) => string | null } | Map<string, string> };
      }
    ).response?.headers;
    if (headers) {
      const ms = this.getHeader(headers, "retry-after-ms");
      if (ms) {
        const n = parseInt(ms, 10);
        if (!isNaN(n)) return n;
      }
      const sec = this.getHeader(headers, "retry-after");
      if (sec) {
        const n = parseInt(sec, 10);
        if (!isNaN(n)) return n * 1000;
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    const m = msg.match(/(?:try again in|retry after)\s+(\d+)\s*(ms|seconds?|s)\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      return unit.startsWith("ms") ? n : n * 1000;
    }
    return null;
  }

  private getHeader(headers: { get?: (k: string) => string | null } | Map<string, string>, key: string): string | null {
    if (headers instanceof Map) return headers.get(key) ?? null;
    if (typeof headers.get === "function") return headers.get(key);
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
