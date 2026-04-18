import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Conversation, ConversationDescriptor } from "../entities/conversation";

/**
 * ConversationRepository
 *
 * Extends the standard company-scoped match with an additional owner check —
 * a user can only see/modify conversations they created.
 *
 * The `$currentUserId` parameter is auto-injected into queryParams by
 * `Neo4jService.initQuery()` (reads `clsService.get("userId")`), so the
 * `buildUserHasAccess` override can reference `$currentUserId` directly.
 */
@Injectable()
export class ConversationRepository extends AbstractRepository<
  Conversation,
  typeof ConversationDescriptor.relationships
> {
  protected readonly descriptor = ConversationDescriptor;

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
