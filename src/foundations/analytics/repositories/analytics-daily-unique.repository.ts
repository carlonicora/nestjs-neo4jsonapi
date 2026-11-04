import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { userMeta } from "../../user/entities/user.meta";
import { AnalyticsDailyUnique, AnalyticsDailyUniqueDescriptor } from "../entities/analytics-daily-unique";
import { analyticsSessionMeta } from "../entities/analytics-session.meta";

const S = analyticsSessionMeta.nodeName; // "analyticsSession"
const U = userMeta.nodeName; // "user"

/**
 * One node per UTC day holding that day's unique visitors and unique users,
 * written by the retention cron before the day's raw sessions are deleted, so
 * the daily uniques charts keep working past the raw retention window.
 *
 * No company predicate: both AnalyticsDailyUnique and AnalyticsSession are
 * isCompanyScoped: false (references/backend/03-repositories.md CRITICAL RULE 4),
 * and buildDefaultMatch() would match this repository's own label, not the
 * AnalyticsSession nodes being aggregated.
 *
 * Every property is set ON CREATE only, so a re-run after a partial raw delete
 * never overwrites the stored counts with smaller ones (same rationale as
 * AnalyticsDailySummaryRepository.rollupDay).
 */
@Injectable()
export class AnalyticsDailyUniqueRepository extends AbstractRepository<
  AnalyticsDailyUnique,
  typeof AnalyticsDailyUniqueDescriptor.relationships
> {
  protected readonly descriptor = AnalyticsDailyUniqueDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /** Adds the date index on top of the id constraint AbstractRepository creates from the descriptor. */
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();

    const { nodeName, labelName } = this.descriptor.model;

    await this.neo4j.writeOne({
      query: `CREATE INDEX ${nodeName}_date IF NOT EXISTS FOR (${nodeName}:${labelName}) ON (${nodeName}.date)`,
    });
  }

  /**
   * MERGEs the AnalyticsDailyUnique node for `date` from the sessions that
   * started that day, every section together. Writes nothing when the day has
   * no sessions. A single write: no rows are read back.
   */
  async rollupDay(params: { date: string }): Promise<void> {
    const { nodeName, labelName } = this.descriptor.model;

    const query = this.neo4j.initQuery({ serialiser: AnalyticsDailyUniqueDescriptor.model });
    query.queryParams = { ...query.queryParams, date: params.date };
    query.query += `
      MATCH (${S}:${analyticsSessionMeta.labelName})
      WHERE date(${S}.startedAt) = date($date)
      OPTIONAL MATCH (${S})-[:BY_USER]->(${U}:${userMeta.labelName})
      WITH count(DISTINCT ${S}.visitorId) AS visitors,
        count(DISTINCT ${U}) AS users,
        count(DISTINCT ${S}) AS sessions
      WHERE sessions > 0
      MERGE (${nodeName}:${labelName} {id: $date})
      ON CREATE SET
        ${nodeName}.date = date(left($date, 10)),
        ${nodeName}.visitors = visitors,
        ${nodeName}.users = users,
        ${nodeName}.createdAt = datetime(),
        ${nodeName}.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }
}
