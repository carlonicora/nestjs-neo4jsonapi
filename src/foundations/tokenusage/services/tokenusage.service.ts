import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { TokenUsageInterface } from "../../../common/interfaces/token.usage.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { TokenUsage, TokenUsageDescriptor } from "../../tokenusage/entities/tokenusage";
import { TokenUsageRepository } from "../../tokenusage/repositories/tokenusage.repository";
import { ModelWeight } from "../../../core/llm/enums/model.weight";
import { TOKEN_USAGE_RECORDED_EVENT, TokenUsageRecordedPayload } from "../events/tokenusage.events";

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
   */
  computeCost(params: { tokens: TokenUsageInterface; useVisionCosts?: boolean; modelWeight?: ModelWeight }): number {
    const costConfig = params.useVisionCosts ? this.aiConfig.vision : this.configForWeight(params.modelWeight);
    const inputRate = costConfig.inputCostPer1MTokens ?? 0;
    const outputRate = costConfig.outputCostPer1MTokens ?? 0;
    // vision/audio configs have no cached rate → falls back to the full input rate (no discount).
    const cachedRate = (costConfig as { cachedInputCostPer1MTokens?: number }).cachedInputCostPer1MTokens ?? inputRate;
    const cached = Math.min(params.tokens.cached ?? 0, params.tokens.input);
    const uncachedInput = params.tokens.input - cached;
    const cost = uncachedInput * inputRate + cached * cachedRate + params.tokens.output * outputRate;
    return cost / 1_000_000;
  }

  async recordTokenUsage(params: {
    tokens: TokenUsageInterface;
    type: string;
    relationshipId: string;
    relationshipType: string;
    useVisionCosts?: boolean;
    modelWeight?: ModelWeight;
  }): Promise<void> {
    const cost = this.computeCost({
      tokens: params.tokens,
      useVisionCosts: params.useVisionCosts,
      modelWeight: params.modelWeight,
    });

    await this.tokenUsageRepository.create({
      id: randomUUID(),
      tokenUsageType: params.type,
      inputTokens: params.tokens.input,
      outputTokens: params.tokens.output,
      cachedInputTokens: params.tokens.cached ?? 0,
      cost: cost,
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
      };
      this.eventEmitter.emit(TOKEN_USAGE_RECORDED_EVENT, payload);
    } catch (error) {
      this.logger.warn(
        `Failed to emit ${TOKEN_USAGE_RECORDED_EVENT}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
