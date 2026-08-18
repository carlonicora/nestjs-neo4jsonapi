import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigAiInterface, ConfigCreditsInterface } from "../../../config/interfaces";
import { TokenUsageInterface } from "../../../common/interfaces/token.usage.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { TokenUsage, TokenUsageDescriptor } from "../../tokenusage/entities/tokenusage";
import {
  TokenUsageAggregated,
  TokenUsageRepository,
  TokenUsageSummary,
} from "../../tokenusage/repositories/tokenusage.repository";
import { ModelWeight } from "../../../core/llm/enums/model.weight";
import { TOKEN_USAGE_RECORDED_EVENT, TokenUsageRecordedPayload } from "../events/tokenusage.events";

/**
 * Per-call cost rates, in euros per 1M tokens, belonging to the AI connection
 * that ACTUALLY served a call.
 *
 * Exists because a call may be served by any link of a DB-backed fallback chain
 * (`AiConnection`), and each link carries its own prices — so the config block
 * for the tier is no longer necessarily the right rate card. Supplied ONLY for
 * candidates whose `source` is `"db"`; an `.env`-sourced candidate passes
 * nothing and keeps the config-block path exactly as before.
 */
export interface TokenUsageRatesInterface {
  inputCostPer1MTokens?: number;
  outputCostPer1MTokens?: number;
  cachedInputCostPer1MTokens?: number;
}

/**
 * TokenUsage service.
 *
 * Extends `AbstractService` so a consuming application can subclass it (see
 * `ExtendedTokenUsageService` in a consuming app) and have BOTH the inherited
 * generic methods AND every method declared here serialise with the *extended*
 * model. Model resolution is by subclass polymorphism — a subclass re-declares
 * `descriptor` and `model` as initialised class fields — never by a registry
 * lookup (Nest constructs providers before `onModuleInit`, where models are
 * registered).
 *
 * Every member is `protected` rather than `private` precisely so a subclass can
 * reuse it: TypeScript forbids a subclass from redeclaring a name a base class
 * holds privately (TS2415), which would otherwise force the extension to invent
 * aliases for its own constructor parameters.
 *
 * Inherited generic CRUD (find / findById / create / put / patch / delete) is
 * unused by any HTTP route in the package — there is no tokenusage controller,
 * records are only ever written through `recordTokenUsage()` — but is available
 * to consuming apps that mount their own controller.
 */
@Injectable()
export class TokenUsageService extends AbstractService<TokenUsage, typeof TokenUsageDescriptor.relationships> {
  protected readonly descriptor = TokenUsageDescriptor;

  protected readonly logger = new Logger(TokenUsageService.name);

  constructor(
    jsonApiService: JsonApiService,
    protected readonly tokenUsageRepository: TokenUsageRepository,
    clsService: ClsService,
    protected readonly configService: ConfigService<BaseConfigInterface>,
    protected readonly eventEmitter: EventEmitter2,
  ) {
    super(jsonApiService, tokenUsageRepository, clsService, TokenUsageDescriptor.model);
  }

  protected get aiConfig(): ConfigAiInterface {
    return this.configService.get<ConfigAiInterface>("ai");
  }

  protected configForWeight(weight?: ModelWeight) {
    switch (weight) {
      case ModelWeight.Lite:
        return this.aiConfig.aiLite;
      case ModelWeight.Large:
        return this.aiConfig.aiLarge;
      default:
        return this.aiConfig.ai;
    }
  }

  /**
   * Computes the monetary cost of a call from the per-tier rates in config
   * (`inputCostPer1MTokens` / `outputCostPer1MTokens`). Single source of truth —
   * used both for persistence and for surfacing cost in ephemeral telemetry.
   *
   * `rates` overrides those config rates with the ones belonging to the AI
   * connection that actually served the call (see
   * {@link TokenUsageRatesInterface}). It is passed ONLY for DB-backed
   * connections, so a caller that never configures any keeps the config-block
   * path bit-for-bit. Each rate falls back to the config block individually, so
   * a connection that prices only some fields still bills the rest at the tier
   * rate — EXCEPT the cached rate, which falls back to the EFFECTIVE input rate
   * rather than the config's cached rate: mixing one connection's input price
   * with another's cache discount would price cached tokens above uncached ones.
   */
  /**
   * The CONFIG tier whose rates price a call — and, when no DB-backed connection
   * supplied its own, the tier that served it.
   *
   * Extracted so `computeCost` and the recorded `model`/`provider` read the same
   * tier: a record billed at the vision rate but labelled with the base model
   * would be worse than an unlabelled one, because it reads as evidence.
   *
   * NOTE: this resolves the CONFIG BLOCK only. When a DB-backed AI connection
   * serves the call it also carries its own `rates`, and its model is NOT this
   * tier's model — such callers must pass `model`/`provider` explicitly, exactly
   * as the `costOverride` callers do.
   */
  protected configForCall(params: { useVisionCosts?: boolean; modelWeight?: ModelWeight }) {
    return params.useVisionCosts ? this.aiConfig.vision : this.configForWeight(params.modelWeight);
  }

  computeCost(params: {
    tokens: TokenUsageInterface;
    useVisionCosts?: boolean;
    modelWeight?: ModelWeight;
    /** Rates of the connection that served the call; overrides the config block. */
    rates?: TokenUsageRatesInterface;
  }): number {
    const costConfig = this.configForCall(params);
    const inputRate = params.rates?.inputCostPer1MTokens ?? costConfig.inputCostPer1MTokens ?? 0;
    const outputRate = params.rates?.outputCostPer1MTokens ?? costConfig.outputCostPer1MTokens ?? 0;
    // vision/audio configs have no cached rate → falls back to the full input rate (no discount).
    const configCachedRate = (costConfig as { cachedInputCostPer1MTokens?: number }).cachedInputCostPer1MTokens;
    const cachedRate =
      params.rates?.cachedInputCostPer1MTokens ?? (params.rates ? inputRate : (configCachedRate ?? inputRate));
    const cached = Math.min(params.tokens.cached ?? 0, params.tokens.input);
    const uncachedInput = params.tokens.input - cached;
    const cost = uncachedInput * inputRate + cached * cachedRate + params.tokens.output * outputRate;
    return cost / 1_000_000;
  }

  /**
   * Persists one usage record and converts its monetary cost into billing
   * credits: `credits = max(minCreditsPerRecord, round4(cost / creditCost))`.
   * `creditCost` absent or 0 disables credits entirely (records store 0 and no
   * balance is deducted), so consumers without a `credits` config are unaffected.
   *
   * Rounded to 4 decimals (not 2): sub-cent operations (a ~144-token
   * transcription utterance, an embedding call) previously rounded to 0.00 at
   * this step even before the per-record floor was applied, so cheap,
   * high-volume calls billed nothing. 4dp keeps them measurable.
   */
  async recordTokenUsage(params: {
    tokens: TokenUsageInterface;
    type: string;
    relationshipId: string;
    relationshipType: string;
    useVisionCosts?: boolean;
    modelWeight?: ModelWeight;
    /** When false the per-record credits floor (`minCreditsPerRecord`) is skipped — sub-cent calls (embeddings) must not be floored. Defaults to true. */
    applyMinimum?: boolean;
    /** Pre-computed cost in euros; when provided `computeCost` is skipped (embeddings: estimated tokens × the embedder rate). */
    costOverride?: number;
    /** Rates of the AI connection that served the call; forwarded to `computeCost`. */
    rates?: TokenUsageRatesInterface;
    /**
     * The model that served the call. MUST be supplied by callers whose model is
     * not the config tier's: those pricing with `costOverride` (embeddings,
     * transcription), and those served by a DB-backed AI connection (which also
     * pass `rates`). Without it the record would name the config-block model for
     * a call that model never made. Everyone else omits it and gets the tier that
     * priced the call.
     */
    model?: string;
    /** Provider that served the call. Same rule as `model`. */
    provider?: string;
  }): Promise<void> {
    const cost =
      params.costOverride ??
      this.computeCost({
        tokens: params.tokens,
        useVisionCosts: params.useVisionCosts,
        modelWeight: params.modelWeight,
        rates: params.rates,
      });

    // Which model to record. An explicit value always wins; otherwise it comes
    // from the tier that priced the call, so the two can never drift apart.
    const tier = this.configForCall({ useVisionCosts: params.useVisionCosts, modelWeight: params.modelWeight });
    const model = params.model ?? tier?.model ?? undefined;
    const provider = params.provider ?? tier?.provider ?? undefined;

    const creditsConfig = this.configService.get<ConfigCreditsInterface>("credits");
    let credits = 0;
    if (creditsConfig && creditsConfig.creditCost > 0) {
      credits = Math.round((cost / creditsConfig.creditCost) * 10000) / 10000;
      if (params.applyMinimum !== false) credits = Math.max(creditsConfig.minCreditsPerRecord, credits);
    }

    await this.tokenUsageRepository.create({
      id: randomUUID(),
      tokenUsageType: params.type,
      inputTokens: params.tokens.input,
      outputTokens: params.tokens.output,
      cachedInputTokens: params.tokens.cached ?? 0,
      cost: cost,
      credits: credits,
      model: model,
      provider: provider,
      relationshipId: params.relationshipId,
      relationshipType: params.relationshipType,
    });

    // Notify listeners (e.g. company balance deduction) that usage occurred.
    // Decoupled via the event bus so this foundation module never imports CompanyModule.
    // Best-effort: emitting must never break the LLM call that triggered it.
    try {
      const payload: TokenUsageRecordedPayload = {
        input: params.tokens.input,
        output: params.tokens.output,
        cost: cost,
        credits: credits,
      };
      this.eventEmitter.emit(TOKEN_USAGE_RECORDED_EVENT, payload);
    } catch (error) {
      this.logger.warn(
        `Failed to emit ${TOKEN_USAGE_RECORDED_EVENT}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * KEPT (custom filtering not covered by inherited find()): date-range + tokenUsageType
   * filtering. Backs GET /tokenusages in consuming apps.
   */
  async findByCompany(params: { query: any; startDate?: string; endDate?: string; tokenUsageType?: string }) {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.jsonApiService.buildList(
      TokenUsageDescriptor.model,
      await this.tokenUsageRepository.findByCompany({
        startDate: params.startDate,
        endDate: params.endDate,
        tokenUsageType: params.tokenUsageType,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  /**
   * KEPT (raw aggregation, not JSON:API entities — inherited find()/findById() can't
   * produce this shape). Backs GET /tokenusages/aggregated in consuming apps.
   */
  async getUsageByDateAndType(params: { startDate?: string; endDate?: string }): Promise<TokenUsageAggregated[]> {
    return this.tokenUsageRepository.findAggregatedByDateAndType({
      startDate: params.startDate,
      endDate: params.endDate,
    });
  }

  /**
   * KEPT (raw aggregation — see getUsageByDateAndType above). Backs GET
   * /tokenusages/summary in consuming apps.
   */
  async getUsageSummary(params: { startDate?: string; endDate?: string }): Promise<TokenUsageSummary> {
    return this.tokenUsageRepository.findUsageSummary({
      startDate: params.startDate,
      endDate: params.endDate,
    });
  }
}
