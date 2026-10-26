// Only caller: AccountDeletionProcessor (through AccountWipeService and FullCompanyDeletionService), never an HTTP request.
//
// Owner-approved exception (Carlo, 2026-10-25, recorded in the account-deletion plan):
// - The wipe deletes nodes of every label that hang off one user or one company, across
//   companies, so it matches by an explicit user / company id instead of buildDefaultMatch().
// - initQuery() is not used: in the processor the CLS carries companyId and userId, and
//   initQuery() would prepend a currentUser-BELONGS_TO-company match that stops matching as
//   soon as the company or the user is gone, turning every later step into a silent no-op.
// - Bulk deletes read their own scalar "deleted" count, which readOne()/readMany() cannot
//   map, so they run through executeInTransaction (writeOne returns null without a serialiser).
// - Every id is a query parameter. Every bulk delete runs LIMIT $batchSize (a neo4j Integer,
//   WIPE_BATCH_SIZE = 1000) per transaction and loops until a batch deletes 0. The patterns
//   interpolated into the query text are constants of this file, never request input.
import { Injectable } from "@nestjs/common";
import { int, isInt } from "neo4j-driver";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { User, UserDescriptor } from "../../user/entities/user";

type WipeQuery = { query: string; queryParams: Record<string, unknown> };

/**
 * Nodes owned by the user, deleted with the account. Each pattern binds the node to delete
 * as `n`; `u` is the user. Order matters: children before the node they hang off.
 */
const USER_LINKED_PATTERNS: string[] = [
  "(u)-[:HAS_AUTH]->(:Auth)-[:HAS_AUTH_CODE]->(n)",
  "(u)-[:HAS_AUTH]->(n)",
  "(u)-[:HAS_TOTP_AUTHENTICATOR]->(n)",
  "(u)-[:HAS_BACKUP_CODE]->(n)",
  "(u)-[:HAS_TWO_FACTOR_CONFIG]->(n)",
  "(u)-[:HAS_PENDING_TWO_FACTOR]->(n)",
  "(u)-[:HAS_PASSKEY]->(n)",
  "(u)-[:OWNS_CLIENT]->(:OAuthClient)-[:ISSUED_ACCESS_TOKEN]->(:OAuthAccessToken)-[:LINKED_REFRESH]->(n)",
  "(u)-[:OWNS_CLIENT]->(:OAuthClient)-[:ISSUED_ACCESS_TOKEN|ISSUED_CODE]->(n)",
  "(u)-[:OWNS_CLIENT]->(n)",
  "(u)-[:AUTHORIZED_CODE]->(n)",
  "(u)-[:HAS_ACCESS_TOKEN]->(:OAuthAccessToken)-[:LINKED_REFRESH]->(n)",
  "(u)-[:HAS_ACCESS_TOKEN]->(n)",
  "(n:OAuthRefreshToken {userId: u.id})",
  "(n:OAuthAccessToken {userId: u.id})",
  "(u)-[:HAS_DISCORD]->(n)",
  "(u)-[:HAS_GOOGLE]->(n)",
  "(u)-[:HAS_PUSH]->(n)",
  "(n:Notification)-[:TRIGGERED_FOR]->(u)",
  "(u)-[:PERFORMED]->(n)",
  "(n:AnalyticsPageView)-[:IN_SESSION]->(:AnalyticsSession)-[:BY_USER]->(u)",
  "(n:AnalyticsSession)-[:BY_USER]->(u)",
  "(u)-[:HAS_MEMBERSHIP]->(n:Membership)",
];

/** Edges from the user to nodes that belong to someone else: the edge goes, the node stays. */
const FOREIGN_EDGE_TYPES = "TRIGGERED_BY|CREATED_BY|CREATED|PUBLISHED|AUTHORED";

/** Email-keyed nodes. `$email` and `$userId` are parameters. */
const EMAIL_KEYED_MATCHES: string[] = [
  "MATCH (n:Waitlist) WHERE ($email <> '' AND toLower(n.email) = toLower($email)) OR n.userId = $userId",
  "MATCH (n:EmailAutomationEnrollment) WHERE $email <> '' AND toLower(n.email) = toLower($email)",
  "MATCH (n:EmailOptOut) WHERE $email <> '' AND toLower(n.email) = toLower($email)",
];

/**
 * Stripe nodes of the company's customer, children first. StripeInvoice has no Company edge
 * (it hangs off the customer and the subscription), so the company sweep alone would orphan it.
 */
const STRIPE_PATTERNS: string[] = [
  "(company)<-[:BELONGS_TO]-(:StripeCustomer)<-[:BELONGS_TO]-(n:StripeInvoice)",
  "(company)<-[:BELONGS_TO]-(:StripeCustomer)<-[:BELONGS_TO]-(:StripeSubscription)<-[:FOR_SUBSCRIPTION]-(n:StripeInvoice)",
  "(company)<-[:BELONGS_TO]-(:StripeCustomer)<-[:BELONGS_TO]-(:StripeSubscription)<-[:BELONGS_TO]-(n:StripeUsageRecord)",
  "(company)<-[:BELONGS_TO]-(:StripeCustomer)--(n:StripePaymentMethod)",
  "(company)<-[:BELONGS_TO]-(:StripeCustomer)<-[:BELONGS_TO]-(n:StripeSubscription)",
  "(company)<-[:BELONGS_TO]-(n:StripeCustomer)",
];

/**
 * Company nodes. Users are never swept here: placeholders are deleted one by one with their
 * user-linked nodes, and members keep their node (the account-deletion flow handles them).
 * Memberships are not swept here either: they go with the Company in deleteCompanyShell, so a
 * crash half way leaves the member still recognised as the company's only member on re-run.
 */
const COMPANY_PATTERNS: string[] = [
  "(company)<-[:BELONGS_TO]-(owner)-[:HAS_CHUNK]->(n:Chunk) WHERE NOT owner:User",
  "(company)<-[:BELONGS_TO]-(n) WHERE NOT n:User AND NOT n:Company",
];

/**
 * Shared knowledge left with nothing pointing at it. AtomicFacts are shared across companies
 * (md5 id), so only facts no chunk links any more go; KeyConcepts go only when nothing at all
 * (fact, community, key-concept relationship) is linked to them.
 */
const DISCONNECTED_KNOWLEDGE_MATCHES: string[] = [
  "MATCH (n:AtomicFact) WHERE NOT (n)<-[:HAS_ATOMIC_FACT]-() // nja-lint-ignore wipe-exception",
  "MATCH (n:KeyConcept) WHERE NOT (n)--() // nja-lint-ignore wipe-exception",
];

@Injectable()
export class AccountDeletionWipeRepository extends AbstractRepository<User, typeof UserDescriptor.relationships> {
  protected readonly descriptor = UserDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  async deleteUserLinkedNodes(params: { userId: string; batchSize: number }): Promise<void> {
    for (const pattern of USER_LINKED_PATTERNS) {
      await this._deleteInBatches(
        this._wipeQuery(
          { userId: params.userId, batchSize: params.batchSize },
          `
          MATCH (u:User {id: $userId}) // nja-lint-ignore wipe-exception
          MATCH ${pattern}
          WITH DISTINCT n LIMIT $batchSize
          DETACH DELETE n
          RETURN count(*) AS deleted
        `,
        ),
      );
    }
  }

  async detachUserFromForeignNodes(params: { userId: string; batchSize: number }): Promise<void> {
    await this._deleteInBatches(
      this._wipeQuery(
        { userId: params.userId, batchSize: params.batchSize },
        `
        MATCH (u:User {id: $userId})-[r:${FOREIGN_EDGE_TYPES}]-() // nja-lint-ignore wipe-exception
        WITH r LIMIT $batchSize
        DELETE r
        RETURN count(*) AS deleted
      `,
      ),
    );
  }

  async deleteEmailKeyed(params: { email: string; userId: string; batchSize: number }): Promise<void> {
    for (const match of EMAIL_KEYED_MATCHES) {
      await this._deleteInBatches(
        this._wipeQuery(
          { email: params.email ?? "", userId: params.userId, batchSize: params.batchSize },
          `
          ${match} // nja-lint-ignore wipe-exception
          WITH n LIMIT $batchSize
          DETACH DELETE n
          RETURN count(*) AS deleted
        `,
        ),
      );
    }
  }

  async deleteStripeNodes(params: { companyId: string; batchSize: number }): Promise<void> {
    for (const pattern of STRIPE_PATTERNS) {
      await this._deleteInBatches(this._companyDelete(params, pattern));
    }
  }

  async deleteCompanyNodes(params: { companyId: string; batchSize: number }): Promise<void> {
    for (const pattern of COMPANY_PATTERNS) {
      await this._deleteInBatches(this._companyDelete(params, pattern));
    }
  }

  async deleteDisconnectedKnowledge(params: { batchSize: number }): Promise<void> {
    for (const match of DISCONNECTED_KNOWLEDGE_MATCHES) {
      await this._deleteInBatches(
        this._wipeQuery(
          { batchSize: params.batchSize },
          `
          ${match}
          WITH n LIMIT $batchSize
          DETACH DELETE n
          RETURN count(*) AS deleted
        `,
        ),
      );
    }
  }

  /**
   * Deletes the Company node and its Memberships in one transaction (a company has a handful
   * of memberships; an orphaned Membership would read as a platform membership). Remaining
   * edges, referrals included, go with the Company.
   */
  async deleteCompanyShell(params: { companyId: string }): Promise<void> {
    const { query, queryParams } = this._wipeQuery(
      { companyId: params.companyId },
      `
      MATCH (company:Company {id: $companyId}) // nja-lint-ignore wipe-exception
      OPTIONAL MATCH (company)<-[:IN_COMPANY]-(membership:Membership)
      DETACH DELETE membership
      WITH DISTINCT company
      DETACH DELETE company
    `,
    );
    await this.neo4j.executeInTransaction([{ query, params: queryParams }]);
  }

  /** Hard-deletes the User node. Last step of an account wipe. */
  async deleteUserNode(params: { userId: string }): Promise<void> {
    const { query, queryParams } = this._wipeQuery(
      { userId: params.userId },
      `
      MATCH (u:User {id: $userId}) // nja-lint-ignore wipe-exception
      DETACH DELETE u
    `,
    );
    await this.neo4j.executeInTransaction([{ query, params: queryParams }]);
  }

  /** Ids of the users of a company (legacy BELONGS_TO edge or a Membership), members first. */
  async findCompanyUserIds(params: { companyId: string }): Promise<string[]> {
    const { query, queryParams } = this._wipeQuery(
      { companyId: params.companyId },
      `
      MATCH (company:Company {id: $companyId}) // nja-lint-ignore wipe-exception
      CALL {
        WITH company
        MATCH (u:User)-[:BELONGS_TO]->(company)
        RETURN u
        UNION
        WITH company
        MATCH (u:User)-[:HAS_MEMBERSHIP]->(:Membership)-[:IN_COMPANY]->(company)
        RETURN u
      }
      WITH DISTINCT company, u
      RETURN u.id AS id,
        EXISTS { (u)-[:HAS_MEMBERSHIP]->(:Membership)-[:IN_COMPANY]->(company) } AS isMember
      ORDER BY isMember DESC, id ASC
    `,
    );
    // nja-lint-ignore wipe-exception
    const result = await this.neo4j.read(query, queryParams);
    return (result.records as any[]).map((record) => String(record.get("id")));
  }

  private _companyDelete(params: { companyId: string; batchSize: number }, pattern: string): WipeQuery {
    return this._wipeQuery(
      { companyId: params.companyId, batchSize: params.batchSize },
      `
      MATCH (company:Company {id: $companyId}) // nja-lint-ignore wipe-exception
      MATCH ${pattern}
      WITH DISTINCT n LIMIT $batchSize
      DETACH DELETE n
      RETURN count(*) AS deleted
    `,
    );
  }

  /** Seeds a query with only the parameters it needs (never the CLS company / user). */
  private _wipeQuery(
    params: { userId?: string; companyId?: string; email?: string; batchSize?: number },
    query: string,
  ): WipeQuery {
    const queryParams: Record<string, unknown> = {};
    if (params.userId !== undefined) queryParams.userId = params.userId;
    if (params.companyId !== undefined) queryParams.companyId = params.companyId;
    if (params.email !== undefined) queryParams.email = params.email;
    if (params.batchSize !== undefined) queryParams.batchSize = int(params.batchSize);
    return { query, queryParams };
  }

  /** Runs one batch per transaction until a batch deletes nothing. */
  private async _deleteInBatches(wipeQuery: WipeQuery): Promise<number> {
    let total = 0;
    for (;;) {
      // nja-lint-ignore wipe-exception
      const [result] = await this.neo4j.executeInTransaction([
        { query: wipeQuery.query, params: wipeQuery.queryParams },
      ]);
      const raw = result?.records?.[0]?.get("deleted");
      const deleted = isInt(raw) ? raw.toNumber() : Number(raw ?? 0);
      if (!deleted) return total;
      total += deleted;
    }
  }
}
