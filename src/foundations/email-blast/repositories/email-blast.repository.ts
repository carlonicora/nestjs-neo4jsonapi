import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { EmailBlast, EmailBlastDescriptor } from "../entities/email-blast";
import { emailBlastDeliveryMeta } from "../entities/email-blast-delivery.meta";
import { emailBlastMeta } from "../entities/email-blast.meta";

@Injectable()
export class EmailBlastRepository extends AbstractRepository<EmailBlast, typeof EmailBlastDescriptor.relationships> {
  protected readonly descriptor = EmailBlastDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Moves a draft to `sending` and stamps `sentAt`. The node's write lock is taken before the
   * draft check, so of two concurrent calls only one matches; null when it is not a draft.
   */
  async markSending(params: { id: string; sentAt: Date }): Promise<EmailBlast | null> {
    const { nodeName } = emailBlastMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailBlastDescriptor.model });

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
      WHERE ${nodeName}.status = "draft"
      SET ${nodeName}.status = "sending",
          ${nodeName}.sentAt = datetime($sentAt),
          ${nodeName}.updatedAt = datetime()
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Moves a `sending` blast to `sent` once none of its deliveries is `pending` or `sending`.
   * Null when the blast is not done yet (or not sending).
   */
  async markSentIfDone(params: { id: string }): Promise<EmailBlast | null> {
    const { nodeName } = emailBlastMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailBlastDescriptor.model });

    query.queryParams = { ...query.queryParams, searchValue: params.id };

    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      SET ${nodeName}._lock = true
      REMOVE ${nodeName}._lock
      WITH ${nodeName}
      WHERE ${nodeName}.status = "sending"
      AND NOT EXISTS {
        MATCH (${nodeName})-[:HAS_DELIVERY]->(open:${emailBlastDeliveryMeta.labelName})
        WHERE open.status IN ["pending", "sending"]
      }
      SET ${nodeName}.status = "sent",
          ${nodeName}.updatedAt = datetime()
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.writeOne(query);
  }

  /**
   * Every blast still sending (the recovery cron re-enqueues them).
   */
  async findSending(): Promise<EmailBlast[]> {
    const { nodeName } = emailBlastMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailBlastDescriptor.model });

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${nodeName}.status = "sending"
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }
}
