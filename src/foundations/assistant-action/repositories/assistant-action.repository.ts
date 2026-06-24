import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AssistantAction, AssistantActionDescriptor, AssistantActionStatus } from "../entities/assistant-action";
import { assistantActionMeta } from "../entities/assistant-action.meta";

/**
 * AssistantActionRepository
 *
 * Owner-RBAC is inherited from the parent Assistant (a user may only see the
 * actions that belong to their own assistants). Company scope is applied
 * automatically via `buildDefaultMatch()` (`isCompanyScoped: true`).
 */
@Injectable()
export class AssistantActionRepository extends AbstractRepository<
  AssistantAction,
  typeof AssistantActionDescriptor.relationships
> {
  protected readonly descriptor = AssistantActionDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  protected buildUserHasAccess(): string {
    const { nodeName } = this.descriptor.model;
    return `WITH ${nodeName}
            WHERE EXISTS {
              MATCH (${nodeName})<-[:HAS_ACTION]-(:Assistant)-[:CREATED_BY]->(:User {id: $currentUserId})
            }
            WITH ${nodeName}`;
  }

  /**
   * Atomically transition the action's status from `from` to `to`, guarded in
   * Cypher so that only one of N concurrent attempts wins (`WHERE status =
   * $from`). Also requires `expiresAt` to be in the future — expired actions
   * can no longer be resolved.
   *
   * Under Neo4j's read-committed isolation a plain `MATCH … WHERE … SET` is
   * check-then-set: the WHERE is evaluated before the write lock is acquired
   * at SET and is NOT re-evaluated afterwards, so two concurrent approves
   * could both pass the guard. The no-op `SET updatedAt = updatedAt` acquires
   * the node's write lock BEFORE the guard (standard Neo4j CAS idiom), making
   * the guard + transition atomic.
   *
   * Owner-RBAC (`buildUserHasAccess`) is injected via
   * `securityService.userHasAccess()`, mirroring the framework's standard
   * write path in AbstractRepository.
   *
   * Returns true when this call won the transition, false otherwise.
   */
  async resolveStatus(params: {
    id: string;
    from: AssistantActionStatus;
    to: AssistantActionStatus;
  }): Promise<boolean> {
    const query = this.neo4j.initQuery({ serialiser: AssistantActionDescriptor.model });
    query.queryParams = { ...query.queryParams, searchValue: params.id, from: params.from, to: params.to };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      ${this.securityService.userHasAccess({ validator: () => this.buildUserHasAccess() })}
      SET ${assistantActionMeta.nodeName}.updatedAt = ${assistantActionMeta.nodeName}.updatedAt
      WITH ${assistantActionMeta.nodeName}
      WHERE ${assistantActionMeta.nodeName}.status = $from AND ${assistantActionMeta.nodeName}.expiresAt > datetime()
      SET ${assistantActionMeta.nodeName}.status = $to,
          ${assistantActionMeta.nodeName}.resolvedAt = datetime(),
          ${assistantActionMeta.nodeName}.updatedAt = datetime()
      WITH ${assistantActionMeta.nodeName}
      ${this.buildReturnStatement()}
    `;
    // writeOne (not readOne): the query contains SET, which Neo4j rejects
    // inside a read transaction. writeOne shares QueryType and returns the
    // serialised entity (or null when the guard did not match).
    const updated = await this.neo4j.writeOne(query);
    return !!updated;
  }

  /**
   * Cross-company sweep used by AssistantActionExpiryCron (runs outside any
   * request, so there is no CLS company context). Mirrors
   * CommunityRepository.findAllStaleCommunities(): the read returns
   * id + companyId pairs so that every subsequent write stays company-scoped.
   */
  async findAllOverduePendingActions(): Promise<{ assistantActionId: string; companyId: string }[]> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, pendingStatus: "pending" satisfies AssistantActionStatus };
    query.query += `
      MATCH (${assistantActionMeta.nodeName}:${assistantActionMeta.labelName} {status: $pendingStatus})-[:BELONGS_TO]->(company:Company)
      WHERE ${assistantActionMeta.nodeName}.expiresAt < datetime()
      RETURN ${assistantActionMeta.nodeName}.id AS assistantActionId, company.id AS companyId
      ORDER BY ${assistantActionMeta.nodeName}.expiresAt ASC
    `;
    const result = await this.neo4j.read(query.query, query.queryParams);
    return result.records.map((record) => ({
      assistantActionId: record.get("assistantActionId") as string,
      companyId: record.get("companyId") as string,
    }));
  }

  /**
   * Company-scoped expiry write for a single overdue pending action, called by
   * AssistantActionExpiryCron with the companyId resolved by the sweep above.
   * Guarded on status AND expiresAt so a concurrent approval/denial between
   * the sweep read and this write is never overwritten.
   */
  async expireAction(params: { assistantActionId: string; companyId: string }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      assistantActionId: params.assistantActionId,
      companyId: params.companyId,
      pendingStatus: "pending" satisfies AssistantActionStatus,
      expiredStatus: "expired" satisfies AssistantActionStatus,
    };
    query.query += `
      MATCH (${assistantActionMeta.nodeName}:${assistantActionMeta.labelName} {id: $assistantActionId})-[:BELONGS_TO]->(company:Company {id: $companyId})
      WHERE ${assistantActionMeta.nodeName}.status = $pendingStatus AND ${assistantActionMeta.nodeName}.expiresAt < datetime()
      SET ${assistantActionMeta.nodeName}.status = $expiredStatus,
          ${assistantActionMeta.nodeName}.resolvedAt = datetime(),
          ${assistantActionMeta.nodeName}.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }
}
