import { mapEntity } from "../../../common/abstracts/entity";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { Community } from "./community.entity";

export const mapCommunity = (params: { data: any; record: any; entityFactory: EntityFactory }): Community => {
  return {
    ...mapEntity({ record: params.data }),
    name: params.data.name,
    summary: params.data.summary,
    embedding: params.data.embedding,
    level: params.data.level,
    rating: params.data.rating,
    memberCount: params.data.memberCount,
    isStale: params.data.isStale,
    staleSince: params.data.staleSince,
    lastProcessedAt: params.data.lastProcessedAt,
    pendingCredits: params.data.pendingCredits,

    company: undefined,
    keyconcept: [],
    community: undefined,
  };
};
