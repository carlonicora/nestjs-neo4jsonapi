import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { EmailOptOut, EmailOptOutDescriptor } from "../entities/email-opt-out";
import { emailOptOutMeta } from "../entities/email-opt-out.meta";

@Injectable()
export class EmailOptOutRepository extends AbstractRepository<EmailOptOut, typeof EmailOptOutDescriptor.relationships> {
  protected readonly descriptor = EmailOptOutDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * The opt-out of an email address (case-insensitive).
   */
  async findByEmail(params: { email: string }): Promise<EmailOptOut | null> {
    const { nodeName } = emailOptOutMeta;
    const query = this.neo4j.initQuery({ serialiser: EmailOptOutDescriptor.model });

    query.queryParams = { ...query.queryParams, email: params.email.toLowerCase() };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE toLower(${nodeName}.email) = $email
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Records an opt-out once per (lower-cased) email; a repeat keeps the first record.
   */
  async createOptOut(params: {
    id: string;
    email: string;
    optedOutAt: Date;
    source: "link" | "header";
  }): Promise<void> {
    const { nodeName, labelName } = emailOptOutMeta;
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      email: params.email,
      optedOutAt: params.optedOutAt.toISOString(),
      source: params.source,
    };

    query.query += `
      MERGE (${nodeName}:${labelName} {email: toLower($email)})
      ON CREATE SET ${nodeName}.id = $id,
                    ${nodeName}.optedOutAt = datetime($optedOutAt),
                    ${nodeName}.source = $source,
                    ${nodeName}.createdAt = datetime(),
                    ${nodeName}.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }
}
