import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AssistantMessage, AssistantMessageDescriptor } from "../entities/assistant-message";

/**
 * AssistantMessageRepository
 *
 * Owner-RBAC is inherited from the parent Assistant (a user may only see the
 * messages that belong to their own assistants). Company scope is applied
 * automatically via `buildDefaultMatch()` (`isCompanyScoped: true`).
 */
@Injectable()
export class AssistantMessageRepository extends AbstractRepository<
  AssistantMessage,
  typeof AssistantMessageDescriptor.relationships
> {
  protected readonly descriptor = AssistantMessageDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  protected buildUserHasAccess(): string {
    const { nodeName } = this.descriptor.model;
    return `WITH ${nodeName}
            WHERE EXISTS {
              MATCH (${nodeName})<-[:HAS_MESSAGE]-(:Assistant)-[:CREATED_BY]->(:User {id: $currentUserId})
            }
            WITH ${nodeName}`;
  }

  /**
   * Resolve the next position to assign to a new AssistantMessage under the
   * given Assistant. Returns 0 for an empty thread, otherwise max(position)+1.
   */
  async getNextPosition(params: { assistantId: string }): Promise<number> {
    const result = await this.neo4j.read(
      `
        MATCH (:Assistant {id: $assistantId})-[:HAS_MESSAGE]->(m:AssistantMessage)
        RETURN coalesce(max(m.position), -1) + 1 AS next
      `,
      { assistantId: params.assistantId },
    );
    const rec = result.records[0];
    if (!rec) return 0;
    const value = rec.get("next");
    return typeof value?.toNumber === "function" ? value.toNumber() : Number(value ?? 0);
  }
}
