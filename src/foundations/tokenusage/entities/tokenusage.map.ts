import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { TokenUsage } from "../../tokenusage/entities/tokenusage.entity";

export const mapTokenUsage = (params: { data: any; record: any; entityFactory: EntityFactory }): TokenUsage => {
  return {
    ...mapEntity({ record: params.data }),
    inputTokens: params.data.inputTokens,
    outputTokens: params.data.outputTokens,
    cachedInputTokens: params.data.cachedInputTokens,
    cost: params.data.cost,
    tokenUsageType: params.data.tokenUsageType,
    company: undefined,
  };
};
