import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { randomUUID } from "crypto";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { TokenUsageInterface } from "../../../common/interfaces/token.usage.interface";
import { TokenUsageRepository } from "../../tokenusage/repositories/tokenusage.repository";
import { ModelWeight } from "../../../core/llm/enums/model.weight";
import { TOKEN_USAGE_RECORDED_EVENT, TokenUsageRecordedPayload } from "../events/tokenusage.events";

@Injectable()
export class TokenUsageService {
  private readonly logger = new Logger(TokenUsageService.name);

  constructor(
    private readonly tokenUsageRepository: TokenUsageRepository,
    private readonly configService: ConfigService<BaseConfigInterface>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private get aiConfig(): ConfigAiInterface {
    return this.configService.get<ConfigAiInterface>("ai");
  }

  private configForWeight(weight?: ModelWeight) {
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
