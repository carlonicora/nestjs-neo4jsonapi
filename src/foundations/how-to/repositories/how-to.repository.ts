import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { HowTo, HowToDescriptor } from "../entities/how-to";
import { howToMeta } from "../entities/how-to.meta";

@Injectable()
export class HowToRepository extends AbstractRepository<HowTo, typeof HowToDescriptor.relationships> {
  protected readonly descriptor = HowToDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Update the AI processing status of a HowTo
   */
  async updateStatus(params: { id: string; aiStatus: AiStatus }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      aiStatus: params.aiStatus,
    };

    query.query = `
      MATCH (${howToMeta.nodeName}:${howToMeta.labelName} {id: $id})
      SET ${howToMeta.nodeName}.aiStatus = $aiStatus, ${howToMeta.nodeName}.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }
}
