import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface, ConfigContentTypesInterface } from "../../../config/interfaces";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import {
  buildLegacyOrderByClause,
  buildListOrderByClause,
  codeOrderBy,
} from "../../../core/neo4j/helpers/build-order-by";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SortCriterion } from "../../../core/neo4j/types/filter.criterion";
import { SecurityService } from "../../../core/security/services/security.service";
import { Content, getContentModel } from "../../content/entities/content";
import { contentMeta } from "../../content/entities/content.meta";
import { ContentCypherService } from "../../content/services/content.cypher.service";
import { ownerMeta } from "../../user/entities/user.meta";

/**
 * Content is a virtual, multi-label aggregate (the labels come from
 * `baseConfig.contentTypes`) with no single Neo4j label of its own, so the
 * inherited AbstractRepository query builders — which assume one
 * `${labelName}` match — cannot express these reads. Every method below is
 * genuinely custom and delegates its Cypher fragments to ContentCypherService.
 *
 * ContentCypherService is also handed, as an instance, to
 * RelevancyService/RelevancyRepository by ContentController (duck-typed as
 * `cypherService: any`, calling `.userHasAccess()` / `.returnStatement()`) for
 * the `/contents/:id/relevance` endpoint. Do not delete it.
 */
@Injectable()
export class ContentRepository {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly contentCypherService: ContentCypherService,
    private readonly securityService: SecurityService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  /**
   * The ORDER BY of a paginated content list. A validated `orderByFields` (from `parseJsonApiSort`)
   * wins; otherwise the legacy `orderBy` (one property and an optional direction, refused with a 400
   * otherwise) or the default `updatedAt DESC`. Both end with `content.id ASC`.
   */
  private listOrderBy(params: { orderBy?: string; orderByFields?: SortCriterion[] }): string {
    if (params.orderByFields?.length)
      return buildListOrderByClause({
        nodeAlias: contentMeta.nodeName,
        sort: params.orderByFields,
        defaultOrderBy: codeOrderBy("content.updatedAt DESC"),
      });

    return buildLegacyOrderByClause({
      nodeAlias: contentMeta.nodeName,
      orderBy: params.orderBy,
      fallback: "updatedAt DESC",
    });
  }

  /** The by-ids read's ORDER BY: the validated sort, else `updatedAt DESC` (the paginated lists' default), always ending with `content.id ASC`. */
  private byIdsOrderBy(orderByFields?: SortCriterion[]): string {
    return `
        WITH *
        ${buildListOrderByClause({
          nodeAlias: contentMeta.nodeName,
          sort: orderByFields,
          defaultOrderBy: codeOrderBy("content.updatedAt DESC"),
        })}`;
  }

  private getContentTypes(): string[] {
    const types = this.configService.get<ConfigContentTypesInterface>("contentTypes")?.types ?? [];
    return types.length > 0 ? types : [contentMeta.labelName];
  }

  async find(params: {
    fetchAll?: boolean;
    term?: string;
    /** Legacy single-field order (`name`, `createdAt DESC`); validated, ignored when `orderByFields` is set. */
    orderBy?: string;
    /** Validated sort (from `parseJsonApiSort`). */
    orderByFields?: SortCriterion[];
    cursor?: JsonApiCursorInterface;
  }): Promise<Content[]> {
    const query = this.neo4j.initQuery({
      cursor: params.cursor,
      serialiser: getContentModel(),
      fetchAll: params.fetchAll,
    });

    query.queryParams = {
      ...query.queryParams,
      term: params.term,
    };

    query.query += `
      ${this.contentCypherService.default()}
      ${this.securityService.userHasAccess({ validator: this.contentCypherService.userHasAccess })}

      ${this.listOrderBy(params)}
      {CURSOR}

      ${this.contentCypherService.returnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  async findByIds(params: {
    contentIds: string[];
    /** Validated sort (from `parseJsonApiSort`); without it the rows are ordered `updatedAt DESC`, then id. */
    orderByFields?: SortCriterion[];
  }): Promise<Content[]> {
    const query = this.neo4j.initQuery({ serialiser: getContentModel() });

    query.queryParams = {
      ...query.queryParams,
      ids: params.contentIds,
    };

    query.query += `
        MATCH (${contentMeta.nodeName}:${this.getContentTypes().join("|")})-[:BELONGS_TO]->(company)
        WHERE ${contentMeta.nodeName}.id IN $ids${this.contentCypherService.tldrFilter()}
        ${this.securityService.userHasAccess({ validator: this.contentCypherService.userHasAccess })}${this.byIdsOrderBy(params.orderByFields)}
        ${this.contentCypherService.returnStatement()}
      `;

    return this.neo4j.readMany(query);
  }

  async findByOwner(params: {
    ownerId: string;
    term?: string;
    /** Legacy single-field order (`name`, `createdAt DESC`); validated, ignored when `orderByFields` is set. */
    orderBy?: string;
    /** Validated sort (from `parseJsonApiSort`). */
    orderByFields?: SortCriterion[];
    fetchAll?: boolean;
    cursor?: JsonApiCursorInterface;
  }) {
    const query = this.neo4j.initQuery({
      serialiser: getContentModel(),
      cursor: params.cursor,
      fetchAll: params.fetchAll,
    });

    query.queryParams = {
      ...query.queryParams,
      ownerId: params.ownerId,
      term: params.term,
    };

    query.query += `
      ${this.contentCypherService.default()}
      ${this.securityService.userHasAccess({ validator: this.contentCypherService.userHasAccess })}
      ${this.contentCypherService.ownerMatch({ target: `:${ownerMeta.labelName} {id: $ownerId}` })}

      ${this.listOrderBy(params)}
      {CURSOR}

      ${this.contentCypherService.returnStatement()}
    `;

    return this.neo4j.readMany(query);
  }
}
