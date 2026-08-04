import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { normalizeNeo4jTemporal } from "../../../common/helpers/neo4j-date";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { companyMeta } from "../../company/entities/company.meta";
import { userMeta } from "../../user/entities/user.meta";
import { UserActivity, UserActivityDescriptor } from "../entities/user-activity";
import { UserActivityRecordInput } from "../interfaces/user-activity.record.input";

@Injectable()
export class UserActivityRepository extends AbstractRepository<
  UserActivity,
  typeof UserActivityDescriptor.relationships
> {
  protected readonly descriptor = UserActivityDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Adds the activity-log-specific indexes (recent-activity scan by
   * createdAt, category+action lookups) on top of the id constraint that
   * AbstractRepository already creates from the descriptor. There is no
   * declarative way to express a plain (non-FULLTEXT) composite index via
   * defineEntity(), so these stay as an explicit override — mirrors the
   * canonical pattern for repositories that need a bespoke index
   * (e.g. a vector index) alongside the descriptor-derived constraints.
   */
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();

    const { nodeName, labelName } = this.descriptor.model;

    await this.neo4j.writeOne({
      query: `CREATE INDEX ${nodeName}_createdAt IF NOT EXISTS FOR (${nodeName}:${labelName}) ON (${nodeName}.createdAt)`,
    });

    await this.neo4j.writeOne({
      query: `CREATE INDEX ${nodeName}_category_action IF NOT EXISTS FOR (${nodeName}:${labelName}) ON (${nodeName}.category, ${nodeName}.action)`,
    });
  }

  /**
   * Records are written from the async BullMQ worker (see
   * UserActivityProcessor), outside HTTP/CLS request context, so this stays a
   * fully custom Cypher write (explicit userId/companyId params, explicit
   * MATCH on both Company and User) rather than the inherited
   * descriptor-driven create(), which expects CLS-derived company scoping.
   * The explicit `(userActivity)-[:BELONGS_TO]->(company)` edge below is the
   * deliberate, documented exception to buildDefaultMatch()-driven company
   * scoping: there is no CLS company to derive at write time.
   * Not renamed: the params shape is domain-specific (UserActivityRecordInput,
   * not the generic `{id, [key: string]: any}`), which is allowed to coexist
   * under the base class's bivariant method-parameter checking.
   */
  async createActivity(input: UserActivityRecordInput): Promise<void> {
    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      id: randomUUID(),
      userId: input.userId,
      companyId: input.companyId,
      category: input.category,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    };

    query.query = `
      MATCH (${userMeta.nodeName}:${userMeta.labelName} {id: $userId})
      MATCH (${companyMeta.nodeName}Target:${companyMeta.labelName} {id: $companyId})
      CREATE (${nodeName}:${labelName} {
        id: $id,
        category: $category,
        action: $action,
        entityType: $entityType,
        entityId: $entityId,
        metadata: $metadata,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      CREATE (${userMeta.nodeName})-[:PERFORMED]->(${nodeName})
      CREATE (${nodeName})-[:BELONGS_TO]->(${companyMeta.nodeName}Target)
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Fully custom traversal (by PERFORMED edge + date range), not expressible
   * via the inherited findByRelated() because `user` is intentionally not a
   * descriptor relationship (see entities/user-activity.ts) and the date
   * filtering is bespoke.
   */
  async findByUser(params: { userId: string; from?: Date; to?: Date; limit?: number }): Promise<UserActivity[]> {
    const { nodeName, labelName } = this.descriptor.model;
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });
    query.queryParams = {
      ...query.queryParams,
      userId: params.userId,
      from: params.from ? normalizeNeo4jTemporal(params.from, "datetime") : null,
      to: params.to ? normalizeNeo4jTemporal(params.to, "datetime") : null,
      limit: params.limit ?? 100,
    };

    query.query = `
      MATCH (${userMeta.nodeName}:${userMeta.labelName} {id: $userId})-[:PERFORMED]->(${nodeName}:${labelName})
      WHERE ($from IS NULL OR ${nodeName}.createdAt >= datetime($from))
        AND ($to IS NULL OR ${nodeName}.createdAt < datetime($to))
      RETURN ${nodeName}
      ORDER BY ${nodeName}.createdAt DESC
      LIMIT toInteger($limit)
    `;

    return this.neo4j.readMany(query);
  }
}
