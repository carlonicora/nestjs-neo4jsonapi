import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Assistant, AssistantDescriptor } from "../entities/assistant";

/**
 * AssistantRepository
 *
 * Extends the standard company-scoped match with an additional owner check —
 * a user can only see/modify assistants they created.
 *
 * The `$currentUserId` parameter is auto-injected into queryParams by
 * `Neo4jService.initQuery()` (reads `clsService.get("userId")`), so the
 * `buildUserHasAccess` override can reference `$currentUserId` directly.
 */
@Injectable()
export class AssistantRepository extends AbstractRepository<Assistant, typeof AssistantDescriptor.relationships> {
  protected readonly descriptor = AssistantDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  protected buildUserHasAccess(): string {
    const { nodeName } = this.descriptor.model;
    return `WITH ${nodeName}
            WHERE EXISTS {
              MATCH (${nodeName})-[:CREATED_BY]->(:User {id: $currentUserId})
            }
            WITH ${nodeName}`;
  }
}
