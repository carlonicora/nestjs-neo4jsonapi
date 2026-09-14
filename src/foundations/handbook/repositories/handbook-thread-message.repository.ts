import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { handbookThreadMeta } from "../entities/handbook-thread.meta";
import { HandbookThreadMessage, HandbookThreadMessageDescriptor } from "../entities/handbook-thread-message";
import { handbookThreadMessageMeta } from "../entities/handbook-thread-message.meta";

/**
 * HandbookThreadMessageRepository
 *
 * A message carries no owner of its own: access is inherited from the parent
 * thread's `CREATED_BY` edge. As with the thread there is no company filter to
 * fall back on, so this override is the only thing standing between one
 * administrator and another's conversation.
 */
@Injectable()
export class HandbookThreadMessageRepository extends AbstractRepository<
  HandbookThreadMessage,
  typeof HandbookThreadMessageDescriptor.relationships
> {
  protected readonly descriptor = HandbookThreadMessageDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  protected buildUserHasAccess(): string {
    const { nodeName } = this.descriptor.model;
    return `WITH ${nodeName}
            WHERE EXISTS {
              MATCH (${nodeName})<-[:HAS_MESSAGE]-(:${handbookThreadMeta.labelName})-[:CREATED_BY]->(:User {id: $currentUserId})
            }
            WITH ${nodeName}`;
  }

  /**
   * Next free position under a thread: 0 for an empty thread, otherwise
   * max(position) + 1. Mirrors `AssistantMessageRepository.getNextPosition`.
   */
  async getNextPosition(params: { threadId: string }): Promise<number> {
    const result = await this.neo4j.read(
      `
        MATCH (:${handbookThreadMeta.labelName} {id: $threadId})-[:HAS_MESSAGE]->(${handbookThreadMessageMeta.nodeName}:${handbookThreadMessageMeta.labelName})
        RETURN coalesce(max(${handbookThreadMessageMeta.nodeName}.position), -1) + 1 AS next
      `,
      { threadId: params.threadId },
    );

    const record = result.records[0];
    if (!record) return 0;
    const value = record.get("next");
    return typeof value?.toNumber === "function" ? value.toNumber() : Number(value ?? 0);
  }
}
