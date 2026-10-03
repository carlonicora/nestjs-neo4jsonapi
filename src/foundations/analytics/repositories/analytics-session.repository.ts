import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { convertFieldValue } from "../../../common/helpers/define-entity";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { userMeta } from "../../user/entities/user.meta";
import { AnalyticsSession, AnalyticsSessionDescriptor } from "../entities/analytics-session";
import { analyticsPageViewMeta } from "../entities/analytics-page-view.meta";
import { AnalyticsResolvedPageView } from "../interfaces/analytics.resolved-page-view";

/** Nodes deleted per transaction by the retention job. */
const DELETE_BATCH_SIZE = 1000;

const toNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof (v as { toNumber?: () => number }).toNumber === "function")
    return (v as { toNumber: () => number }).toNumber();
  return Number(v) || 0;
};

/**
 * Sessions are platform-level (`isCompanyScoped: false`) and are written from
 * the BullMQ worker (see AnalyticsProcessor), outside HTTP/CLS context, so the
 * writes are fully custom Cypher, as UserActivityRepository.createActivity()
 * does. Every datetime write casts with `datetime($receivedAt)`.
 *
 * The retention methods (deleteDay, unlinkDeletedUsers, findExpiredDays) return
 * scalar counts or days rather than graph nodes, so readOne()/readMany() cannot
 * map them; they read the scalar columns off the driver result, the same shape
 * and rationale as TokenUsageAdminRepository.
 */
@Injectable()
export class AnalyticsSessionRepository extends AbstractRepository<
  AnalyticsSession,
  typeof AnalyticsSessionDescriptor.relationships
> {
  protected readonly descriptor = AnalyticsSessionDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Adds the session lookup index (visitor + recency, used by recordPageView)
   * and the startedAt index (admin lists, retention) on top of the id
   * constraint AbstractRepository creates from the descriptor.
   */
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();

    const { nodeName, labelName } = this.descriptor.model;

    await this.neo4j.writeOne({
      query: `CREATE INDEX ${nodeName}_visitorId_lastSeenAt IF NOT EXISTS FOR (${nodeName}:${labelName}) ON (${nodeName}.visitorId, ${nodeName}.lastSeenAt)`,
    });

    await this.neo4j.writeOne({
      query: `CREATE INDEX ${nodeName}_startedAt IF NOT EXISTS FOR (${nodeName}:${labelName}) ON (${nodeName}.startedAt)`,
    });
  }

  /**
   * One transaction for the whole session resolution of spec §4: find the
   * visitor's open session (lastSeenAt within the timeout), create it with this
   * event's attribution when there is none, otherwise bump lastSeenAt and
   * pageViews; then create the page view and, when the event carries a user
   * and the session has none yet, the BY_USER edge.
   *
   * The new session id is generated here, so `created` is simply whether the
   * returned session carries it. The session is returned through the
   * descriptor serialiser (writeOne + serialiser), never as a raw record.
   */
  async recordPageView(input: AnalyticsResolvedPageView): Promise<{ sessionId: string; created: boolean }> {
    const { nodeName, labelName } = this.descriptor.model;
    const newSessionId = randomUUID();

    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model });
    query.queryParams = {
      ...query.queryParams,
      newSessionId,
      pageViewId: randomUUID(),
      visitorId: input.visitorId,
      consented: input.consented,
      path: input.path,
      route: input.route,
      section: input.section,
      referrerHost: input.referrerHost ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      utmTerm: input.utmTerm ?? null,
      utmContent: input.utmContent ?? null,
      deviceType: input.deviceType,
      userId: input.userId ?? null,
      receivedAt: input.receivedAt,
      sessionTimeoutMinutes: input.sessionTimeoutMinutes,
      ...this.getPolyLabelParams(),
    };

    query.query = `
      OPTIONAL MATCH (openSession:${labelName} {visitorId: $visitorId})
      WHERE openSession.lastSeenAt >= datetime($receivedAt) - duration({minutes: $sessionTimeoutMinutes})
      WITH openSession
      ORDER BY openSession.lastSeenAt DESC
      LIMIT 1
      MERGE (${nodeName}:${labelName} {id: coalesce(openSession.id, $newSessionId)})
      ON CREATE SET ${nodeName} += {
        visitorId: $visitorId,
        consented: $consented,
        startedAt: datetime($receivedAt),
        pageViews: 0,
        section: $section,
        landingRoute: $route,
        referrerHost: $referrerHost,
        utmSource: $utmSource,
        utmMedium: $utmMedium,
        utmCampaign: $utmCampaign,
        utmTerm: $utmTerm,
        utmContent: $utmContent,
        deviceType: $deviceType,
        createdAt: datetime($receivedAt)
      }
      SET ${nodeName}.lastSeenAt = datetime($receivedAt),
        ${nodeName}.pageViews = ${nodeName}.pageViews + 1,
        ${nodeName}.updatedAt = datetime($receivedAt)
      CREATE (${analyticsPageViewMeta.nodeName}:${analyticsPageViewMeta.labelName} {
        id: $pageViewId,
        path: $path,
        route: $route,
        section: $section,
        createdAt: datetime($receivedAt),
        updatedAt: datetime($receivedAt)
      })-[:IN_SESSION]->(${nodeName})
      WITH ${nodeName}
      OPTIONAL MATCH (${userMeta.nodeName}:${userMeta.labelName} {id: $userId})
      WITH ${nodeName}, ${userMeta.nodeName}
      FOREACH (_ IN CASE
        WHEN $userId IS NOT NULL AND ${userMeta.nodeName} IS NOT NULL AND NOT EXISTS { (${nodeName})-[:BY_USER]->(:${userMeta.labelName}) }
        THEN [1] ELSE [] END |
        MERGE (${nodeName})-[:BY_USER]->(${userMeta.nodeName})
      )
      WITH ${nodeName}
      ${this.buildReturnStatement()}
    `;

    const session = await this.neo4j.writeOne(query);
    if (!session) throw new Error(`Analytics page view for ${input.visitorId} returned no session`);

    return { sessionId: session.id, created: session.id === newSessionId };
  }

  /**
   * Administration list, newest first, with the `user` relationship included.
   * Never binds its own companyId: the only one present is what initQuery()
   * seeds from CLS for the calling administrator.
   */
  async findForAdmin(params: {
    cursor: JsonApiCursorInterface;
    from: string;
    to: string;
    section: "all" | "public" | "app";
    visitorId?: string;
    userId?: string;
  }): Promise<AnalyticsSession[]> {
    const { nodeName } = this.descriptor.model;
    const query = this.neo4j.initQuery({ serialiser: this.descriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      from: params.from,
      to: params.to,
      section: params.section,
      visitorId: params.visitorId ?? null,
      userId: params.userId ?? null,
      ...this.getPolyLabelParams(),
    };

    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${nodeName}.startedAt >= datetime($from)
        AND ${nodeName}.startedAt <= datetime($to)
        AND ($section = 'all' OR ${nodeName}.section = $section)
        AND ($visitorId IS NULL OR ${nodeName}.visitorId = $visitorId)
        AND ($userId IS NULL OR EXISTS { (${nodeName})-[:BY_USER]->(:${userMeta.labelName} {id: $userId}) })
      WITH ${nodeName}
      ORDER BY ${nodeName}.startedAt DESC
      {CURSOR}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Deletes the page views, then the sessions, of every session that started
   * on `date`, at most DELETE_BATCH_SIZE nodes per transaction. A loop of
   * batched transactions rather than `CALL { } IN TRANSACTIONS`: the latter
   * only runs in an implicit (auto-commit) transaction, and every
   * Neo4jService write path opens an explicit one.
   */
  async deleteDay(params: { date: string }): Promise<{ sessions: number; pageViews: number }> {
    const { nodeName, labelName } = this.descriptor.model;
    const pv = analyticsPageViewMeta;

    const pageViews = await this._deleteInBatches({
      date: params.date,
      query: `
        MATCH (${pv.nodeName}:${pv.labelName})-[:IN_SESSION]->(${nodeName}:${labelName})
        WHERE date(${nodeName}.startedAt) = date($date)
        WITH ${pv.nodeName}
        LIMIT toInteger($batchSize)
        DETACH DELETE ${pv.nodeName}
        RETURN count(*) AS deleted
      `,
    });

    const sessions = await this._deleteInBatches({
      date: params.date,
      query: `
        MATCH (${nodeName}:${labelName})
        WHERE date(${nodeName}.startedAt) = date($date)
        WITH ${nodeName}
        LIMIT toInteger($batchSize)
        DETACH DELETE ${nodeName}
        RETURN count(*) AS deleted
      `,
    });

    return { sessions, pageViews };
  }

  /** Removes every BY_USER edge whose user has been soft-deleted. Returns the edges removed. */
  async unlinkDeletedUsers(): Promise<number> {
    const [result] = await this.neo4j.executeInTransaction([
      {
        query: `
          MATCH (:${this.descriptor.model.labelName})-[r:BY_USER]->(${userMeta.nodeName}:${userMeta.labelName} {isDeleted: true})
          DELETE r
          RETURN count(*) AS unlinked
        `,
        params: {},
      },
    ]);

    return toNumber(result?.records?.[0]?.get("unlinked"));
  }

  /** Distinct calendar days (`YYYY-MM-DD`) with raw sessions before `cutoff`, oldest first. */
  async findExpiredDays(params: { cutoff: string; limit: number }): Promise<string[]> {
    const { nodeName, labelName } = this.descriptor.model;

    const result = await this.neo4j.read(
      `
        MATCH (${nodeName}:${labelName})
        WHERE date(${nodeName}.startedAt) < date($cutoff)
        WITH DISTINCT date(${nodeName}.startedAt) AS day
        RETURN day
        ORDER BY day ASC
        LIMIT toInteger($limit)
      `,
      { cutoff: params.cutoff, limit: params.limit },
    );

    return result.records.map((r: any) => convertFieldValue(r.get("day"), "date") as string);
  }

  private async _deleteInBatches(params: { date: string; query: string }): Promise<number> {
    let total = 0;
    let deleted: number;

    do {
      const [result] = await this.neo4j.executeInTransaction([
        { query: params.query, params: { date: params.date, batchSize: DELETE_BATCH_SIZE } },
      ]);
      deleted = toNumber(result?.records?.[0]?.get("deleted"));
      total += deleted;
    } while (deleted >= DELETE_BATCH_SIZE);

    return total;
  }
}
