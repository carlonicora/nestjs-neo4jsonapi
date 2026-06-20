import { Injectable, OnModuleInit } from "@nestjs/common";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { tokenUsageMeta } from "../../tokenusage/entities/tokenusage.meta";

@Injectable()
export class TokenUsageRepository implements OnModuleInit {
  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT ${tokenUsageMeta.nodeName}_id IF NOT EXISTS FOR (${tokenUsageMeta.nodeName}:${tokenUsageMeta.labelName}) REQUIRE ${tokenUsageMeta.nodeName}.id IS UNIQUE`,
    });
  }

  async create(params: {
    id: string;
    tokenUsageType: string;
    inputTokens: number;
    outputTokens: number;
    cost?: number;
    relationshipId: string;
    relationshipType: string;
  }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      tokenUsageType: params.tokenUsageType,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      relationshipId: params.relationshipId,
      cost: params.cost ?? 0,
    };

    query.query += `
      CREATE (tokenusage:TokenUsage {
        id: $id,
        tokenUsageType: $tokenUsageType,
        inputTokens: $inputTokens,
        outputTokens: $outputTokens,
        cost: $cost,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (tokenusage)-[:BELONGS_TO]->(company)
      CREATE (tokenusage)-[:TRIGGERED_BY]->(currentUser)
      WITH tokenusage
      MATCH (relEntity:${params.relationshipType} {id: $relationshipId})
      CREATE (tokenusage)-[:USED_FOR]->(relEntity)
    `;

    await this.neo4j.writeOne(query);
  }
}
