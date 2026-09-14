import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { HandbookThread, HandbookThreadDescriptor } from "../entities/handbook-thread";
import { handbookThreadMeta } from "../entities/handbook-thread.meta";
import { handbookThreadMessageMeta } from "../entities/handbook-thread-message.meta";

/**
 * HandbookThreadRepository
 *
 * `HandbookThread` is `isCompanyScoped: false`, so `buildDefaultMatch()` emits
 * no company filter at all — the `CREATED_BY` owner edge asserted here is the
 * ENTIRE security boundary. Without this override every administrator would
 * read and mutate every other administrator's threads.
 *
 * `$currentUserId` is auto-injected into queryParams by
 * `Neo4jService.initQuery()` (it reads `clsService.get("userId")`), exactly as
 * `AssistantRepository` relies on.
 */
@Injectable()
export class HandbookThreadRepository extends AbstractRepository<
  HandbookThread,
  typeof HandbookThreadDescriptor.relationships
> {
  protected readonly descriptor = HandbookThreadDescriptor;

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

  /**
   * Bump `updatedAt` so the thread list — ordered by the descriptor default
   * `updatedAt DESC` — surfaces the conversation a user just spoke in. Neither
   * creating a child message nor writing the `HAS_MESSAGE` edge touches the
   * parent node, so without this an active thread would sink below a thread
   * that was merely renamed.
   */
  async touch(params: { id: string }): Promise<void> {
    await this.neo4j.writeOne({
      query: `
        MATCH (${handbookThreadMeta.nodeName}:${handbookThreadMeta.labelName} {id: $id})
        SET ${handbookThreadMeta.nodeName}.updatedAt = datetime()
      `,
      queryParams: { id: params.id },
    });
  }

  /**
   * Delete the thread AND its messages. `DETACH DELETE` on the thread alone
   * would drop the `HAS_MESSAGE` edges and orphan every message node, which
   * — because the messages are only ever reachable through their thread —
   * means they could never be read or deleted again.
   *
   * Mirrors `AssistantRepository.delete`.
   */
  async delete(params: { id: string }): Promise<void> {
    await this.neo4j.writeOne({
      query: `
        MATCH (${handbookThreadMeta.nodeName}:${handbookThreadMeta.labelName} {id: $id})
        OPTIONAL MATCH (${handbookThreadMeta.nodeName})-[:HAS_MESSAGE]->(${handbookThreadMessageMeta.nodeName}:${handbookThreadMessageMeta.labelName})
        DETACH DELETE ${handbookThreadMeta.nodeName}, ${handbookThreadMessageMeta.nodeName}
      `,
      queryParams: { id: params.id },
    });
  }
}
