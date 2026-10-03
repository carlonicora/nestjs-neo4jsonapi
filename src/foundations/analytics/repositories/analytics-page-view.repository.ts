import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { AnalyticsPageView, AnalyticsPageViewDescriptor } from "../entities/analytics-page-view";
import { analyticsSessionMeta } from "../entities/analytics-session.meta";

/**
 * Page views are created by AnalyticsSessionRepository.recordPageView() in the
 * same transaction as their session; this repository only owns the createdAt
 * index and the per-session journey read.
 */
@Injectable()
export class AnalyticsPageViewRepository extends AbstractRepository<
  AnalyticsPageView,
  typeof AnalyticsPageViewDescriptor.relationships
> {
  protected readonly descriptor = AnalyticsPageViewDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /** Adds the createdAt index on top of the id constraint AbstractRepository creates from the descriptor. */
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();

    const { nodeName, labelName } = this.descriptor.model;

    await this.neo4j.writeOne({
      query: `CREATE INDEX ${nodeName}_createdAt IF NOT EXISTS FOR (${nodeName}:${labelName}) ON (${nodeName}.createdAt)`,
    });
  }

  /** Every page view of one session, in the order they were visited. */
  async findBySession(params: { sessionId: string }): Promise<AnalyticsPageView[]> {
    const { nodeName } = this.descriptor.model;
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });

    query.queryParams = {
      ...query.queryParams,
      sessionId: params.sessionId,
      ...this.getPolyLabelParams(),
    };

    query.query += `
      ${this.buildDefaultMatch()}
      MATCH (${nodeName})-[:IN_SESSION]->(:${analyticsSessionMeta.labelName} {id: $sessionId})
      WITH ${nodeName}
      ${this.buildReturnStatement()}
      ORDER BY ${nodeName}.createdAt ASC
    `;

    return this.neo4j.readMany(query);
  }
}
