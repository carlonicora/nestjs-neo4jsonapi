import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { TokenUsage, TokenUsageDescriptor } from "../../tokenusage/entities/tokenusage";
import { tokenUsageMeta } from "../../tokenusage/entities/tokenusage.meta";

/**
 * TokenUsage repository.
 *
 * Extends `AbstractRepository` so a consuming application can subclass it (see
 * `ExtendedTokenUsageRepository` in a consuming app) and have BOTH the inherited
 * generic methods AND every method declared here resolve the *extended*
 * descriptor. Model resolution is by subclass polymorphism — `this.descriptor` —
 * never by a registry lookup: Nest constructs providers long before
 * `onModuleInit`, where models are registered.
 *
 * `onModuleInit` is INHERITED rather than declared: `AbstractRepository.onModuleInit`
 * emits `CREATE CONSTRAINT tokenusage_id IF NOT EXISTS FOR (tokenusage:TokenUsage)
 * REQUIRE tokenusage.id IS UNIQUE` from `descriptor.constraints` — byte-identical to
 * the constraint this repository used to declare by hand — plus the FULLTEXT index
 * derived from the descriptor's string fields.
 */
@Injectable()
export class TokenUsageRepository extends AbstractRepository<TokenUsage, typeof TokenUsageDescriptor.relationships> {
  protected readonly descriptor = TokenUsageDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Custom create (KEPT — "non-standard relationships" rule): USED_FOR's target is
   * polymorphic (any entity label — Content, Chunk, Conversation, ...), which the
   * descriptor's fixed-target `relationships` cannot express as a single
   * relationship. BELONGS_TO (company) and TRIGGERED_BY (currentUser) rely on the
   * CLS-injected preamble from `Neo4jService.initQuery()` — unchanged from the
   * pre-migration repository. Cannot be replaced by the inherited
   * descriptor-driven `create()`, which only knows fixed relationships declared
   * on the descriptor.
   */
  async create(params: {
    id: string;
    tokenUsageType: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
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
      cachedInputTokens: params.cachedInputTokens ?? 0,
      relationshipId: params.relationshipId,
      cost: params.cost ?? 0,
    };

    query.query += `
      CREATE (${tokenUsageMeta.nodeName}:${tokenUsageMeta.labelName} {
        id: $id,
        tokenUsageType: $tokenUsageType,
        inputTokens: $inputTokens,
        outputTokens: $outputTokens,
        cachedInputTokens: $cachedInputTokens,
        cost: $cost,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${tokenUsageMeta.nodeName})-[:BELONGS_TO]->(company)
      CREATE (${tokenUsageMeta.nodeName})-[:TRIGGERED_BY]->(currentUser)
      WITH ${tokenUsageMeta.nodeName}
      MATCH (relEntity:${params.relationshipType} {id: $relationshipId})
      CREATE (${tokenUsageMeta.nodeName})-[:USED_FOR]->(relEntity)
    `;

    await this.neo4j.writeOne(query);
  }
}
