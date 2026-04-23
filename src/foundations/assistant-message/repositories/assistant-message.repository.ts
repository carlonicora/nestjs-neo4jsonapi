import { Injectable, Logger } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { modelRegistry } from "../../../common/registries/registry";
import type { ChatbotReference } from "../../../agents/chatbot/interfaces/chatbot.response.interface";
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

  private readonly refLogger = new Logger(AssistantMessageRepository.name);

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

  /**
   * Materialise one (:AssistantMessage)-[:REFERENCES { reason, createdAt }]->(target)
   * edge per reference. JSON:API type → Neo4j label is resolved through the
   * pre-seeded modelRegistry. Unknown types are logged and skipped.
   *
   * Idempotent via MERGE.
   */
  async linkReferences(params: { messageId: string; references: ChatbotReference[] }): Promise<void> {
    for (const ref of params.references) {
      const model = modelRegistry.getByType(ref.type);
      if (!model) {
        this.refLogger.warn(
          `linkReferences: unknown JSON:API type "${ref.type}" for ref id=${ref.id} — skipping edge (message id=${params.messageId})`,
        );
        continue;
      }
      const label = model.labelName;
      await this.neo4j.writeOne({
        query: `
          MATCH (m:AssistantMessage {id: $messageId})
          MATCH (e:${label} {id: $refId})
          MERGE (m)-[r:REFERENCES]->(e)
          SET r.reason = $reason, r.createdAt = coalesce(r.createdAt, datetime())
        `,
        queryParams: {
          messageId: params.messageId,
          refId: ref.id,
          reason: ref.reason,
        },
      });
    }
  }

  /**
   * For the given message IDs, return every (messageId, targetType, targetId) triple
   * for the outgoing :REFERENCES edges. Label is mapped to JSON:API type via modelRegistry.
   */
  async findReferencedTypeIdPairs(params: {
    messageIds: string[];
  }): Promise<{ messageId: string; type: string; id: string }[]> {
    if (params.messageIds.length === 0) return [];
    const result = await this.neo4j.read(
      `
        MATCH (m:AssistantMessage)-[:REFERENCES]->(e)
        WHERE m.id IN $messageIds
        RETURN m.id AS messageId, labels(e)[0] AS label, e.id AS id
      `,
      { messageIds: params.messageIds },
    );
    const pairs: { messageId: string; type: string; id: string }[] = [];
    for (const rec of result.records) {
      const label = rec.get("label") as string;
      const model = modelRegistry.getByLabelName(label);
      if (!model) continue; // unknown label — skip silently
      pairs.push({
        messageId: rec.get("messageId") as string,
        type: model.type,
        id: rec.get("id") as string,
      });
    }
    return pairs;
  }
}
