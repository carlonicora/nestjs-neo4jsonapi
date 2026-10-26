import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { SecurityService } from "../../../core/security/services/security.service";
import { companyMeta } from "../../company/entities/company.meta";
import { revokeUserOAuthTokensClause } from "../../oauth/queries/revoke-user-oauth-tokens.query";
import { User, UserDescriptor } from "../../user/entities/user";
import { userMeta } from "../../user/entities/user.meta";

/**
 * Reads and writes of the account-deletion request on the User node.
 *
 * Owner decision OD-1 (Carlo, 2026-10-25): this repository reads a User and its
 * Memberships by explicit id with no company predicate, for exactly six callers
 * (self preview/request, admin preview/request on another user, the public keep
 * link, the daily cron, the login hook and the worker processor), and runs three
 * hand-written writes by user id (setRequest, clearRequest, deleteSessions).
 * A user deleting their account is not scoped to one company: a placeholder
 * player belongs to the GM's company, an administrator acts on any user, and the
 * keep link and the cron run with no session at all. Every query therefore runs
 * in a fresh CLS context (`ifNested: "override"`), so `initQuery` binds no
 * caller company or user. Every id is a query parameter. User nodes come back
 * through readOne/readMany with the User serialiser; only findMembershipSummary
 * returns a scalar row.
 */
@Injectable()
export class AccountDeletionRepository extends AbstractRepository<User, typeof UserDescriptor.relationships> {
  protected readonly descriptor = UserDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /** Runs the callback in an empty CLS context: no caller company or user is bound (OD-1). */
  private _unscoped<T>(callback: () => Promise<T>): Promise<T> {
    return this.clsService.run({ ifNested: "override" }, callback);
  }

  private _userReturn(): string {
    return `
      OPTIONAL MATCH (${userMeta.nodeName})-[:BELONGS_TO]->(${userMeta.nodeName}_${companyMeta.nodeName}:${companyMeta.labelName})
      RETURN ${userMeta.nodeName}, ${userMeta.nodeName}_${companyMeta.nodeName}
    `;
  }

  async findTargetUser(params: { userId: string }): Promise<User | null> {
    return this._unscoped(async () => {
      const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model });
      query.queryParams = { ...query.queryParams, userId: params.userId };
      // nja-lint-ignore OD-1
      query.query += `
        MATCH (${userMeta.nodeName}:${userMeta.labelName} {id: $userId})
        ${this._userReturn()}
      `;
      return this.neo4j.readOne(query);
    });
  }

  async findByUndoTokenHash(params: { undoTokenHash: string }): Promise<User | null> {
    return this._unscoped(async () => {
      const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model });
      query.queryParams = { ...query.queryParams, undoTokenHash: params.undoTokenHash };
      // nja-lint-ignore OD-1
      query.query += `
        MATCH (${userMeta.nodeName}:${userMeta.labelName} {deletionUndoTokenHash: $undoTokenHash})
        ${this._userReturn()}
      `;
      return this.neo4j.readOne(query);
    });
  }

  /** Users whose grace period is over. Worker cron only. */
  async findDue(params: { now: string }): Promise<User[]> {
    return this._unscoped(async () => {
      const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model, fetchAll: true });
      query.queryParams = { ...query.queryParams, now: params.now };
      // nja-lint-ignore OD-1
      query.query += `
        MATCH (${userMeta.nodeName}:${userMeta.labelName})
        WHERE ${userMeta.nodeName}.deletionScheduledAt IS NOT NULL
          AND ${userMeta.nodeName}.deletionScheduledAt <= datetime($now)
        ${this._userReturn()}
      `;
      return this.neo4j.readMany(query);
    });
  }

  /**
   * The company of the user's Membership (preferring the company the user also
   * BELONGS_TO) and how many Memberships that company has. A placeholder user
   * (no Membership) gets `{ companyId: null, memberCount: 0 }`.
   */
  async findMembershipSummary(params: { userId: string }): Promise<{ companyId: string | null; memberCount: number }> {
    return this._unscoped(async () => {
      // nja-lint-ignore OD-1
      const result = await this.neo4j.read(
        `
        MATCH (user:User {id: $userId})
        OPTIONAL MATCH (user)-[:HAS_MEMBERSHIP]->(:Membership)-[:IN_COMPANY]->(company:Company)
        WITH user, company
        ORDER BY CASE WHEN company IS NOT NULL AND EXISTS { (user)-[:BELONGS_TO]->(company) } THEN 0 ELSE 1 END
        WITH collect(company)[0] AS company
        OPTIONAL MATCH (member:Membership)-[:IN_COMPANY]->(company)
        RETURN company.id AS companyId, count(DISTINCT member) AS memberCount
        `,
        { userId: params.userId },
      );

      // nja-lint-ignore OD-1 (scalar row: company id and a count, no entity node)
      const record = result.records?.[0];
      if (!record) return { companyId: null, memberCount: 0 };

      const companyId = record.get("companyId");
      const memberCount = record.get("memberCount");
      return {
        companyId: companyId ?? null,
        memberCount: typeof memberCount?.toNumber === "function" ? memberCount.toNumber() : Number(memberCount ?? 0),
      };
    });
  }

  async setRequest(params: {
    userId: string;
    requestedAt: string;
    scheduledAt: string;
    undoTokenHash: string | null;
  }): Promise<void> {
    await this._unscoped(async () => {
      const query = this.neo4j.initQuery();
      query.queryParams = {
        ...query.queryParams,
        userId: params.userId,
        requestedAt: params.requestedAt,
        scheduledAt: params.scheduledAt,
        undoTokenHash: params.undoTokenHash,
      };
      // nja-lint-ignore OD-1
      query.query += `
        MATCH (user:User {id: $userId})
        SET user.deletionRequestedAt = datetime($requestedAt),
            user.deletionScheduledAt = datetime($scheduledAt),
            user.deletionUndoTokenHash = $undoTokenHash,
            user.updatedAt = datetime()
      `;
      await this.neo4j.writeOne(query);
    });
  }

  async clearRequest(params: { userId: string }): Promise<void> {
    await this._unscoped(async () => {
      const query = this.neo4j.initQuery();
      query.queryParams = { ...query.queryParams, userId: params.userId };
      // nja-lint-ignore OD-1
      query.query += `
        MATCH (user:User {id: $userId})
        REMOVE user.deletionRequestedAt, user.deletionScheduledAt, user.deletionUndoTokenHash
        SET user.updatedAt = datetime()
      `;
      await this.neo4j.writeOne(query);
    });
  }

  /** Logs the user out everywhere: every Auth and AuthCode, and every OAuth token revoked. */
  async deleteSessions(params: { userId: string }): Promise<void> {
    await this._unscoped(async () => {
      const query = this.neo4j.initQuery();
      query.queryParams = { ...query.queryParams, userId: params.userId };
      // nja-lint-ignore OD-1
      query.query += `
        MATCH (user:User {id: $userId})
        CALL {
          WITH user
          MATCH (user)-[:HAS_AUTH]->(:Auth)-[:HAS_AUTH_CODE]->(code:AuthCode)
          DETACH DELETE code
        }
        CALL {
          WITH user
          MATCH (user)-[:HAS_AUTH]->(auth:Auth)
          DETACH DELETE auth
        }
        WITH user
        ${revokeUserOAuthTokensClause("user")}
        RETURN user.id AS userId
      `;
      await this.neo4j.writeOne(query);
    });
  }
}
