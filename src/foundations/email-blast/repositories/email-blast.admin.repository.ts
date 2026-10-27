// nja-lint-ignore-file: cross-tenant administrative read repository.
//
// The recipient count of a blast covers every company's users, so buildDefaultMatch(), which
// scopes to the caller's company, would undercount; initQuery() is skipped for the same reason
// (it prepends the caller's company MATCH). The query returns one scalar count, which
// readOne()/readMany() cannot map. Only EmailBlastController.findAudience and .send reach it,
// gated by JwtAuthGuard and Roles(SystemRoles.Administrator).
//
// Queries seed themselves from _adminQuery(); no query here binds a parameter named companyId.
import { Injectable } from "@nestjs/common";
import { isInt } from "neo4j-driver";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { ELIGIBLE_RECIPIENTS_CYPHER } from "../email-blast.constants";
import { EmailBlastAudience, EmailBlastAudienceDescriptor } from "../entities/email-blast-audience";

type AdminQuery = { query: string; queryParams: Record<string, unknown> };

@Injectable()
export class EmailBlastAdminRepository extends AbstractRepository<
  EmailBlastAudience,
  typeof EmailBlastAudienceDescriptor.relationships
> {
  // Only satisfies the base class: nothing here goes through the inherited CRUD.
  protected readonly descriptor = EmailBlastAudienceDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * How many distinct addresses a blast would reach right now (the same eligibility block the
   * snapshot uses). `id` is the blast id.
   */
  async countEligibleRecipients(params: { blastId: string }): Promise<EmailBlastAudience> {
    const seed = this._adminQuery();

    seed.query = `
      ${ELIGIBLE_RECIPIENTS_CYPHER}
      RETURN count(email) AS recipientCount
    `;

    const result = await this.neo4j.read(seed.query, seed.queryParams);
    const raw = (result.records as any[])[0]?.get("recipientCount");

    return {
      id: params.blastId,
      recipientCount: isInt(raw) ? raw.toNumber() : Number(raw ?? 0),
    } as EmailBlastAudience;
  }

  /** Seeds a query with only the parameters it needs: none (never the caller's companyId). */
  private _adminQuery(): AdminQuery {
    return { query: "", queryParams: {} };
  }
}
