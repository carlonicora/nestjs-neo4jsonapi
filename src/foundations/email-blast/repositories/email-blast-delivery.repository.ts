import { Injectable } from "@nestjs/common";
import { int } from "neo4j-driver";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { ELIGIBLE_RECIPIENTS_CYPHER } from "../email-blast.constants";
import { EmailBlastDelivery, EmailBlastDeliveryDescriptor } from "../entities/email-blast-delivery";
import { emailBlastDeliveryMeta } from "../entities/email-blast-delivery.meta";
import { emailBlastMeta } from "../entities/email-blast.meta";

/** Alias of the blast whose counter a delivery write raises (never the return statement's alias). */
const COUNTED_BLAST = "countedBlast";

/**
 * Every guarded write that changes a counter takes the delivery's write lock first and re-checks
 * its guard after it (SET _lock / REMOVE _lock / WITH / WHERE), so two concurrent calls never both
 * pass. The blast's lock is taken before its counter is read, so concurrent increments never lose
 * one. A counter moves in the same query as the status it counts.
 */
@Injectable()
export class EmailBlastDeliveryRepository extends AbstractRepository<
  EmailBlastDelivery,
  typeof EmailBlastDeliveryDescriptor.relationships
> {
  protected readonly descriptor = EmailBlastDeliveryDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Builds the recipient list of a blast once: one pending delivery per eligible, distinct
   * lower-cased email, and the blast's recipientCount (0 when nobody is eligible).
   *
   * Owner-approved exception (Carlo, 2026-10-27, decision D-1 of the email-blasts plan):
   * - Only caller: EmailBlastDeliveryService.processBlast in the worker job, never an HTTP request.
   * - The recipients are every company's users, so the query reads User nodes across companies
   *   instead of buildDefaultMatch(), which scopes to one company.
   * - initQuery() is not used: the worker CLS carries no company, and the query needs no
   *   request alias. The blast is matched by an explicit id parameter.
   * - Deliveries store userId as a field, never an edge to User.
   * - validateRelatedNodes is not called: the only relationship target is the blast, matched by
   *   id in the same query, and for a tenancy "internal" target with no company in context the
   *   check is existence only.
   * - The write returns no node, so it runs through executeInTransaction.
   * - A second run does nothing: the blast's write lock is taken first, then the query stops
   *   when the blast already has a delivery.
   */
  async createSnapshot(params: { blastId: string }): Promise<void> {
    const blast = emailBlastMeta.nodeName;
    const delivery = emailBlastDeliveryMeta.nodeName;

    const query = `
      MATCH (${blast}:${emailBlastMeta.labelName} {id: $blastId})
      SET ${blast}._lock = true
      REMOVE ${blast}._lock
      WITH ${blast}
      WHERE NOT EXISTS {
        MATCH (${blast})-[:HAS_DELIVERY]->(:${emailBlastDeliveryMeta.labelName})
      }
      CALL {
        ${ELIGIBLE_RECIPIENTS_CYPHER}
        RETURN collect({ email: email, recipient: recipient }) AS rows
      }
      FOREACH (row IN rows |
        CREATE (${delivery}:${emailBlastDeliveryMeta.labelName} {
          id: randomUUID(),
          email: row.email,
          name: row.recipient.name,
          userId: row.recipient.id,
          status: "pending",
          unsubscribeToken: randomUUID(),
          createdAt: datetime(),
          updatedAt: datetime()
        })
        CREATE (${blast})-[:HAS_DELIVERY]->(${delivery})
      )
      SET ${blast}.recipientCount = size(rows),
          ${blast}.updatedAt = datetime()
    `;

    await this.neo4j.executeInTransaction([{ query, params: { blastId: params.blastId } }]);
  }

  /**
   * Claims up to `limit` pending deliveries of a blast (pending to sending), oldest first.
   */
  async claimBatch(params: { blastId: string; limit: number; claimedAt: Date }): Promise<EmailBlastDelivery[]> {
    const { nodeName } = emailBlastDeliveryMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailBlastDeliveryDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      blastId: params.blastId,
      limit: int(params.limit),
      claimedAt: params.claimedAt.toISOString(),
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${nodeName}.status = "pending"
      AND EXISTS {
        MATCH (${nodeName})<-[:HAS_DELIVERY]-(:${emailBlastMeta.labelName} {id: $blastId})
      }
      WITH ${nodeName}
      ORDER BY ${nodeName}.createdAt ASC
      LIMIT $limit
      SET ${nodeName}._lock = true
      REMOVE ${nodeName}._lock
      WITH ${nodeName}
      WHERE ${nodeName}.status = "pending"
      SET ${nodeName}.status = "sending",
          ${nodeName}.claimedAt = datetime($claimedAt),
          ${nodeName}.updatedAt = datetime()
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    return (await this.neo4j.writeAndReturnMany(query)) ?? [];
  }

  /**
   * A claimed delivery was sent: sending to sent, and the blast's sentCount + 1.
   */
  async markSent(params: { id: string; sentAt: Date }): Promise<void> {
    const { nodeName } = emailBlastDeliveryMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailBlastDeliveryDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      searchValue: params.id,
      sentAt: params.sentAt.toISOString(),
    };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      SET ${nodeName}._lock = true
      REMOVE ${nodeName}._lock
      WITH ${nodeName}
      WHERE ${nodeName}.status = "sending"
      ${this._lockCountedBlast()}
      SET ${nodeName}.status = "sent",
          ${nodeName}.sentAt = datetime($sentAt),
          ${nodeName}.updatedAt = datetime(),
          ${COUNTED_BLAST}.sentCount = coalesce(${COUNTED_BLAST}.sentCount, 0) + 1
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * A claimed delivery failed to send: sending to failed (never retried), and the blast's
   * failedCount + 1.
   */
  async markFailed(params: { id: string; error: string }): Promise<void> {
    const { nodeName } = emailBlastDeliveryMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailBlastDeliveryDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.id, error: params.error };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      SET ${nodeName}._lock = true
      REMOVE ${nodeName}._lock
      WITH ${nodeName}
      WHERE ${nodeName}.status = "sending"
      ${this._lockCountedBlast()}
      SET ${nodeName}.status = "failed",
          ${nodeName}.error = $error,
          ${nodeName}.updatedAt = datetime(),
          ${COUNTED_BLAST}.failedCount = coalesce(${COUNTED_BLAST}.failedCount, 0) + 1
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * A claimed delivery whose address opted out after the snapshot: sending to skipped. No counter.
   */
  async markSkipped(params: { id: string }): Promise<void> {
    const { nodeName } = emailBlastDeliveryMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailBlastDeliveryDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.id };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      SET ${nodeName}._lock = true
      REMOVE ${nodeName}._lock
      WITH ${nodeName}
      WHERE ${nodeName}.status = "sending"
      SET ${nodeName}.status = "skipped",
          ${nodeName}.updatedAt = datetime()
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Every delivery claimed before `claimedBefore` and still sending goes to failed (never resent),
   * and its blast's failedCount rises by one per delivery, in one query.
   */
  async failStuck(params: { claimedBefore: Date }): Promise<void> {
    const { nodeName } = emailBlastDeliveryMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailBlastDeliveryDescriptor.model });

    query.queryParams = { ...query.queryParams, claimedBefore: params.claimedBefore.toISOString() };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${nodeName}.status = "sending"
      AND ${nodeName}.claimedAt < datetime($claimedBefore)
      SET ${nodeName}._lock = true
      REMOVE ${nodeName}._lock
      WITH ${nodeName}
      WHERE ${nodeName}.status = "sending"
      AND ${nodeName}.claimedAt < datetime($claimedBefore)
      ${this._lockCountedBlast()}
      SET ${nodeName}.status = "failed",
          ${nodeName}.error = "stuck",
          ${nodeName}.updatedAt = datetime(),
          ${COUNTED_BLAST}.failedCount = coalesce(${COUNTED_BLAST}.failedCount, 0) + 1
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    await this.neo4j.writeAndReturnMany(query);
  }

  /**
   * The delivery an unsubscribe link belongs to, with its blast.
   */
  async findByUnsubscribeToken(params: { token: string }): Promise<EmailBlastDelivery | null> {
    const query = this.neo4j.initQuery({ serialiser: EmailBlastDeliveryDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.token };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "unsubscribeToken" })}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Stamps the first unsubscribe of a delivery and raises the blast's unsubscribedCount, once.
   * True when this call was the one that matched.
   */
  async markUnsubscribed(params: { id: string; unsubscribedAt: Date }): Promise<boolean> {
    const { nodeName } = emailBlastDeliveryMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailBlastDeliveryDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      searchValue: params.id,
      unsubscribedAt: params.unsubscribedAt.toISOString(),
    };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      SET ${nodeName}._lock = true
      REMOVE ${nodeName}._lock
      WITH ${nodeName}
      WHERE ${nodeName}.unsubscribedAt IS NULL
      ${this._lockCountedBlast()}
      SET ${nodeName}.unsubscribedAt = datetime($unsubscribedAt),
          ${nodeName}.updatedAt = datetime(),
          ${COUNTED_BLAST}.unsubscribedCount = coalesce(${COUNTED_BLAST}.unsubscribedCount, 0) + 1
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    return !!(await this.neo4j.writeOne(query));
  }

  /** Binds the delivery's blast as COUNTED_BLAST and takes its write lock before a counter is read. */
  private _lockCountedBlast(): string {
    const { nodeName } = emailBlastDeliveryMeta;
    return `
      MATCH (${nodeName})<-[:HAS_DELIVERY]-(${COUNTED_BLAST}:${emailBlastMeta.labelName})
      SET ${COUNTED_BLAST}._lock = true
      REMOVE ${COUNTED_BLAST}._lock
      WITH ${nodeName}, ${COUNTED_BLAST}
    `;
  }
}
