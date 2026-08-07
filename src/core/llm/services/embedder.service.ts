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
    const result = await this.modelService.getEmbedder().embedQuery(params.text);
    await this.persistUsage([params.text], params.attribution);
    return result;
  }

  async vectoriseTextBatch(texts: string[], attribution?: EmbedderAttribution): Promise<any[]> {
    const result = await this.modelService.getEmbedder().embedDocuments(texts);
    await this.persistUsage(texts, attribution);
    return result;
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
  private async persistUsage(texts: string[], attribution?: EmbedderAttribution): Promise<void> {
    if (!attribution?.relationshipId || !attribution?.relationshipType) return;
    const embedderConfig = this.config.get<ConfigAiInterface>("ai")?.embedder;
    const rate = embedderConfig?.inputCostPer1MTokens ?? 0;
    if (rate <= 0) return;
    const recorder = this.tokenUsageRecorder ?? this.tokenUsageService;
    if (!recorder) return;
    try {
      const tokens = this.countTokens(texts, embedderConfig);
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
