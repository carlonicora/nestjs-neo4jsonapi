import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AiConnection, AiConnectionDescriptor } from "../entities/ai-connection";
import { aiConnectionMeta } from "../entities/ai-connection.meta";

/**
 * AiConnectionRepository
 *
 * No `buildReturnStatement()` override is needed. The inherited implementation
 * (abstract.repository.ts) skips the `company` relationship only for
 * `isCompanyScoped` entities whose edge is `BELONGS_TO`; this descriptor is
 * `isCompanyScoped: false` with a `CONFIGURES` edge, so the generic loop emits
 * `OPTIONAL MATCH (aiConnection)-[:CONFIGURES]->(aiConnection_company:Company)`
 * (optional because `required: false`) and returns `aiConnection_company` —
 * exactly what the `companyId` computed field reads.
 */
@Injectable()
export class AiConnectionRepository extends AbstractRepository<
  AiConnection,
  typeof AiConnectionDescriptor.relationships
> {
  protected readonly descriptor = AiConnectionDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Full-table system read for the resolver snapshot. Unpaginated by design:
   * this is the resolver's boot/refresh scan over an admin-scale node set
   * (spec § 2 — scale is trivial, tens of nodes), not a user-facing list.
   */
  async findAllForResolver(): Promise<AiConnection[]> {
    const query = this.neo4j.initQuery({ serialiser: AiConnectionDescriptor.model });
    query.query = `
      ${this.buildDefaultMatch()}
      ORDER BY ${aiConnectionMeta.nodeName}.connectionType ASC, ${aiConnectionMeta.nodeName}.position ASC
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * The connections named by the reorder request, with their computed
   * companyId — the service checks they all belong to one chain before
   * renumbering.
   */
  async findByIds(params: { ids: string[] }): Promise<AiConnection[]> {
    const query = this.neo4j.initQuery({ serialiser: AiConnectionDescriptor.model });
    query.queryParams = { ...query.queryParams, ids: params.ids };
    query.query = `
      ${this.buildDefaultMatch()}
      WHERE ${aiConnectionMeta.nodeName}.id IN $ids
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * Renumbers one chain to the given order. Single parameterized statement —
   * writeOne because the query contains SET (read transactions reject it).
   */
  async updatePositions(params: { ids: string[] }): Promise<void> {
    await this.neo4j.writeOne({
      query: `
        UNWIND range(0, size($ids) - 1) AS idx
        MATCH (${aiConnectionMeta.nodeName}:${aiConnectionMeta.labelName} { id: $ids[idx] })
        SET ${aiConnectionMeta.nodeName}.position = idx
      `,
      queryParams: { ids: params.ids },
    });
  }
}
