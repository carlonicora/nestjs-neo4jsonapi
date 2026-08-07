import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { TokenUsage, TokenUsageDescriptor } from "../../tokenusage/entities/tokenusage";
import { tokenUsageMeta } from "../../tokenusage/entities/tokenusage.meta";

/**
 * A single row of the date + operation-type usage aggregation.
 *
 * Not an entity shape: the aggregation returns grouped scalars, so it
 * deliberately bypasses the serialiser (`readMany`) — there is nothing to map
 * onto `TokenUsage`.
 */
export interface TokenUsageAggregated {
  date: string;
  tokenUsageType: string;
  totalCredits: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  count: number;
}

/**
 * The single-row totals of the usage summary. Same non-entity rationale as
 * `TokenUsageAggregated`.
 */
export interface TokenUsageSummary {
  totalCredits: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  count: number;
}

/**
 * TokenUsage repository.
 *
 * Extends `AbstractRepository` so a consuming application can subclass it (see
 * `ExtendedTokenUsageRepository` in a consuming app) and have BOTH the inherited
 * generic methods AND every method declared here resolve the *extended*
 * descriptor. Model resolution is by subclass polymorphism — `this.descriptor` —
 * never by a registry lookup: Nest constructs providers long before
 * `onModuleInit`, where models are registered.
 *
 * `onModuleInit` DELEGATES to `AbstractRepository.onModuleInit` first, which emits
 * `CREATE CONSTRAINT tokenusage_id IF NOT EXISTS FOR (tokenusage:TokenUsage)
 * REQUIRE tokenusage.id IS UNIQUE` from `descriptor.constraints` — byte-identical to
 * the constraint this repository used to declare by hand — plus the FULLTEXT index
 * derived from the descriptor's string fields. It then adds the one index the
 * descriptor cannot express; see the override below.
 */
@Injectable()
export class TokenUsageRepository extends AbstractRepository<TokenUsage, typeof TokenUsageDescriptor.relationships> {
  protected readonly descriptor = TokenUsageDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Adds the range index every date-filtered finder here depends on —
   * findByCompany, findAggregatedByDateAndType, findUsageSummary, and the
   * cross-tenant admin queries in TokenUsageAdminRepository. Without it each of
   * them scans the whole :TokenUsage label, which is the fastest-growing label
   * in the database.
   *
   * There is no declarative way to express a non-FULLTEXT index via
   * defineEntity(): EntityDescriptor.indexes is hard-coded to the string-field
   * fulltext index, and AbstractRepository.onModuleInit only acts on
   * type === "FULLTEXT". Hence the explicit override — same pattern, and same
   * stated reason, as UserActivityRepository.
   *
   * super.onModuleInit() MUST be called first: it creates the descriptor-derived
   * id constraint and fulltext index. Dropping it would silently remove both.
   */
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();

    const { nodeName, labelName } = this.descriptor.model;

    await this.neo4j.writeOne({
      query: `CREATE INDEX ${nodeName}_createdAt IF NOT EXISTS FOR (${nodeName}:${labelName}) ON (${nodeName}.createdAt)`,
    });
  }

  /**
   * Custom create (KEPT — "non-standard relationships" rule): USED_FOR's target is
   * polymorphic (any entity label — Content, Chunk, Conversation, ...), which the
   * descriptor's fixed-target `relationships` cannot express as a single
   * relationship. BELONGS_TO (company) and TRIGGERED_BY (currentUser) rely on the
   * CLS-injected preamble from `Neo4jService.initQuery()` — unchanged from the
   * pre-migration repository. Cannot be replaced by the inherited
   * descriptor-driven `create()`, which only knows fixed relationships declared
   * on the descriptor.
   */
  async create(params: {
    id: string;
    tokenUsageType: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cost?: number;
    credits?: number;
    relationshipId: string;
    relationshipType: string;
  }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      tokenUsageType: params.tokenUsageType,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cachedInputTokens: params.cachedInputTokens ?? 0,
      relationshipId: params.relationshipId,
      cost: params.cost ?? 0,
      credits: params.credits ?? 0,
    };

    // Guarded: initQuery() binds this variable only when the id is in CLS; an unbound CREATE target creates an orphan node.
    query.query += `
      CREATE (${tokenUsageMeta.nodeName}:${tokenUsageMeta.labelName} {
        id: $id,
        tokenUsageType: $tokenUsageType,
        inputTokens: $inputTokens,
        outputTokens: $outputTokens,
        cachedInputTokens: $cachedInputTokens,
        cost: $cost,
        credits: $credits,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      ${query.queryParams.companyId ? `CREATE (${tokenUsageMeta.nodeName})-[:BELONGS_TO]->(company)` : ``}
      ${query.queryParams.currentUserId ? `CREATE (${tokenUsageMeta.nodeName})-[:TRIGGERED_BY]->(currentUser)` : ``}
      WITH ${tokenUsageMeta.nodeName}
      MATCH (relEntity:${params.relationshipType} {id: $relationshipId})
      CREATE (${tokenUsageMeta.nodeName})-[:USED_FOR]->(relEntity)
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Custom list (KEPT — date-range + tokenUsageType filtering is not expressible via the
   * inherited descriptor-driven find()). Reuses buildDefaultMatch()/buildReturnStatement()
   * for company scoping and security consistency.
   */
  async findByCompany(params: {
    startDate?: string;
    endDate?: string;
    tokenUsageType?: string;
    cursor?: JsonApiCursorInterface;
  }): Promise<TokenUsage[]> {
    const query = this.neo4j.initQuery({ serialiser: TokenUsageDescriptor.model, cursor: params.cursor });

    if (params.startDate) {
      query.queryParams = { ...query.queryParams, startDate: params.startDate };
    }
    if (params.endDate) {
      query.queryParams = { ...query.queryParams, endDate: params.endDate };
    }
    if (params.tokenUsageType) {
      query.queryParams = { ...query.queryParams, tokenUsageType: params.tokenUsageType };
    }

    query.query += `
      ${this.buildDefaultMatch()}
      ${this.securityService.userHasAccess({ validator: () => this.buildUserHasAccess() })}
      ${params.startDate ? `WHERE ${tokenUsageMeta.nodeName}.createdAt >= datetime($startDate)` : ""}
      ${params.endDate ? `${params.startDate ? "AND" : "WHERE"} ${tokenUsageMeta.nodeName}.createdAt <= datetime($endDate)` : ""}
      ${params.tokenUsageType ? `${params.startDate || params.endDate ? "AND" : "WHERE"} ${tokenUsageMeta.nodeName}.tokenUsageType = $tokenUsageType` : ""}

      ORDER BY ${tokenUsageMeta.nodeName}.createdAt DESC
      {CURSOR}

      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  /**
   * Aggregation query (KEPT — "aggregations" rule): returns grouped totals, not
   * TokenUsage entities, so it intentionally bypasses readMany()/the serialiser — there
   * is nothing to map onto the entity type.
   */
  async findAggregatedByDateAndType(params: { startDate?: string; endDate?: string }): Promise<TokenUsageAggregated[]> {
    const query = this.neo4j.initQuery();

    if (params.startDate) {
      query.queryParams = { ...query.queryParams, startDate: params.startDate };
    }
    if (params.endDate) {
      query.queryParams = { ...query.queryParams, endDate: params.endDate };
    }

    query.query += `
      ${this.buildDefaultMatch()}
      ${params.startDate ? `WHERE ${tokenUsageMeta.nodeName}.createdAt >= datetime($startDate)` : ""}
      ${params.endDate ? `${params.startDate ? "AND" : "WHERE"} ${tokenUsageMeta.nodeName}.createdAt <= datetime($endDate)` : ""}

      WITH date(${tokenUsageMeta.nodeName}.createdAt) as usageDate,
           ${tokenUsageMeta.nodeName}.tokenUsageType as usageType,
           ${tokenUsageMeta.nodeName}

      RETURN toString(usageDate) as date,
             usageType as tokenUsageType,
             round(sum(toFloat(${tokenUsageMeta.nodeName}.credits)), 2) as totalCredits,
             sum(toInteger(${tokenUsageMeta.nodeName}.inputTokens)) as totalInputTokens,
             sum(toInteger(${tokenUsageMeta.nodeName}.outputTokens)) as totalOutputTokens,
             sum(toFloat(${tokenUsageMeta.nodeName}.cost)) as totalCost,
             count(${tokenUsageMeta.nodeName}) as count
      ORDER BY date DESC, tokenUsageType
    `;

    const result = await this.neo4j.read(query.query, query.queryParams); // nja-lint-ignore: buildDefaultMatch()-scoped scalar aggregation — non-entity shape

    return result.records.map((record: any) => ({
      // nja-lint-ignore: aggregation rows, not entity nodes
      date: record.get("date"),
      tokenUsageType: record.get("tokenUsageType"),
      totalCredits: this.toNumber(record.get("totalCredits")),
      totalInputTokens: this.toNumber(record.get("totalInputTokens")),
      totalOutputTokens: this.toNumber(record.get("totalOutputTokens")),
      totalCost: this.toNumber(record.get("totalCost")),
      count: this.toNumber(record.get("count")),
    }));
  }

  /**
   * Aggregation query (KEPT — see findAggregatedByDateAndType above), single-row totals.
   */
  async findUsageSummary(params: { startDate?: string; endDate?: string }): Promise<TokenUsageSummary> {
    const query = this.neo4j.initQuery();

    if (params.startDate) {
      query.queryParams = { ...query.queryParams, startDate: params.startDate };
    }
    if (params.endDate) {
      query.queryParams = { ...query.queryParams, endDate: params.endDate };
    }

    query.query += `
      ${this.buildDefaultMatch()}
      ${params.startDate ? `WHERE ${tokenUsageMeta.nodeName}.createdAt >= datetime($startDate)` : ""}
      ${params.endDate ? `${params.startDate ? "AND" : "WHERE"} ${tokenUsageMeta.nodeName}.createdAt <= datetime($endDate)` : ""}

      RETURN round(sum(toFloat(${tokenUsageMeta.nodeName}.credits)), 2) as totalCredits,
             sum(toInteger(${tokenUsageMeta.nodeName}.inputTokens)) as totalInputTokens,
             sum(toInteger(${tokenUsageMeta.nodeName}.outputTokens)) as totalOutputTokens,
             sum(toFloat(${tokenUsageMeta.nodeName}.cost)) as totalCost,
             count(${tokenUsageMeta.nodeName}) as count
    `;

    const result = await this.neo4j.read(query.query, query.queryParams); // nja-lint-ignore: buildDefaultMatch()-scoped scalar aggregation — non-entity shape

    if (result.records.length === 0) {
      return {
        totalCredits: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        count: 0,
      };
    }

    const record = result.records[0];
    return {
      totalCredits: this.toNumber(record.get("totalCredits")),
      totalInputTokens: this.toNumber(record.get("totalInputTokens")),
      totalOutputTokens: this.toNumber(record.get("totalOutputTokens")),
      totalCost: this.toNumber(record.get("totalCost")),
      count: this.toNumber(record.get("count")),
    };
  }

  private toNumber(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === "number") return value;
    if (typeof value.toNumber === "function") return value.toNumber();
    return Number(value) || 0;
  }
}
