import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { TokenUsageInterface } from "../../../common/interfaces/token.usage.interface";
import { TokenUsageRepository } from "../../tokenusage/repositories/tokenusage.repository";
import { ModelWeight } from "../../../core/llm/enums/model.weight";

@Injectable()
export class TokenUsageService {
  constructor(
    private readonly tokenUsageRepository: TokenUsageRepository,
    private readonly configService: ConfigService<BaseConfigInterface>,
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
    const inputCost = (params.tokens.input / 1_000_000) * (costConfig.inputCostPer1MTokens ?? 0);
    const outputCost = (params.tokens.output / 1_000_000) * (costConfig.outputCostPer1MTokens ?? 0);
    return inputCost + outputCost;
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
      cost: cost,
      relationshipId: params.relationshipId,
      relationshipType: params.relationshipType,
    });
  }
}
