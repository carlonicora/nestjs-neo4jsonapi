import { HttpException, HttpStatus, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { BaseConfigInterface, ConfigContentTypesInterface } from "../../../config/interfaces";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { ContentDescriptor } from "../../content/entities/content";
import { contentMeta } from "../../content/entities/content.meta";
import { ContentCypherService } from "../../content/services/content.cypher.service";
import { RelevanceRepositoryInterface } from "../../relevancy/interfaces/relevance.repository.interface";
import { authorQuery, contentQuery, contentToAuthorQuery } from "../../relevancy/queries/relevance";
import { User, UserDescriptor } from "../../user/entities/user";

@Injectable()
export class RelevancyRepository<T> implements RelevanceRepositoryInterface<T> {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly securityService: SecurityService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    /**
     * The Content access rule the SOURCE of a content relevance read must pass.
     * Provided by the global `ContentModule`; absent when an app excludes it,
     * in which case the source is checked for company scoping only.
     */
    @Optional() private readonly contentCypherService?: ContentCypherService,
  ) {}

  /**
   * The configured content labels (`baseConfig.contentTypes`, the label union
   * `ContentCypherService` and `ContentRepository` read). Every `{id: $id}`
   * lookup of the source content is constrained to them, so it is an index seek
   * per label rather than a scan of every node. Empty when no content type is
   * configured: the lookups then stay unlabelled, as they always were.
   */
  private getContentLabels(): string[] {
    return this.configService.get<ConfigContentTypesInterface>("contentTypes")?.types ?? [];
  }

  /** `content:Article|Document|…`, or the bare `content` alias when no label is configured. */
  private contentNodePattern(): string {
    const labels = this.getContentLabels();
    return `${contentMeta.nodeName}${labels.length > 0 ? `:${labels.join("|")}` : ``}`;
  }

  /**
   * The caller must be able to open the source content `$id` before anything
   * related to it is computed: the source must belong to the caller's company
   * and pass the Content access rule (`ContentCypherService.userHasAccess()`,
   * which carries the per-label `accessPredicates`; skipped for automated jobs).
   *
   * Mirrors `AbstractRepository.findById` for an unreadable record: 403 when the
   * node exists in the caller's company but the caller may not open it, 404
   * otherwise. The existence probe joins the same `company` initQuery binds, so
   * another firm's id is a plain 404 and reveals nothing. With no company in
   * context there is no firm to scope the source to: 404 before any query.
   */
  private async assertSourceAccessible(params: { id: string }): Promise<void> {
    const query = this.neo4j.initQuery({ serialiser: ContentDescriptor.model });
    if (!query.queryParams.companyId) throw new HttpException(`not found`, HttpStatus.NOT_FOUND);

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
    };

    query.query += `
      MATCH (${this.contentNodePattern()} {id: $id})-[:BELONGS_TO]->(company)
      ${
        this.contentCypherService
          ? this.securityService.userHasAccess({ validator: () => this.contentCypherService.userHasAccess() })
          : ``
      }
      RETURN ${contentMeta.nodeName}
    `;

    if (await this.neo4j.readOne(query)) return;

    const probe = this.neo4j.initQuery({ serialiser: ContentDescriptor.model });
    probe.queryParams = { ...probe.queryParams, id: params.id };
    probe.query += `
      MATCH (${this.contentNodePattern()} {id: $id})-[:BELONGS_TO]->(company)
      RETURN ${contentMeta.nodeName}
    `;

    if (await this.neo4j.readOne(probe)) throw new HttpException(`Forbidden`, HttpStatus.FORBIDDEN);
    throw new HttpException(`not found`, HttpStatus.NOT_FOUND);
  }

  private async _findRelevant<T>(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    id: string;
    type?: string;
    cursor?: JsonApiCursorInterface;
  }): Promise<T[]> {
    await this.assertSourceAccessible({ id: params.id });

    const query = this.neo4j.initQuery({ serialiser: params.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
    };

    const validator = (): string => params.cypherService.userHasAccess({ useTotalScore: true });

    // The page is cut after EVERY filter — the source exclusion, the score
    // threshold and the access check — so a page is filled from qualifying rows
    // and the pagination total (the query up to {CURSOR}) counts the same rows.
    // `WITH *` gives ORDER BY a projection to attach to whatever the access
    // check emits (nothing at all for automated jobs).
    query.query += `${contentQuery({ sourceLabels: this.getContentLabels() })}
      WITH content as ${params.model.nodeName}, totalScore
      WHERE ${params.model.nodeName}.id <> $id
      AND totalScore > 20
      ${query.queryParams.companyId ? `MATCH (company:Company {id: $companyId})` : ``}
      ${
        query.queryParams.currentUserId
          ? query.queryParams.companyId
            ? `MATCH (currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company)`
            : `MATCH (currentUser:User {id: $currentUserId})`
          : ``
      }

      ${this.securityService.userHasAccess({ validator: validator })}
      WITH *
      ORDER BY totalScore DESC
      {CURSOR}
      ${params.cypherService.returnStatement({ useTotalScore: true })}
    `;

    return this.neo4j.readMany(query);
  }

  private async _findRelevantByAuthor<T>(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    id: string;
    type: string;
    cursor?: JsonApiCursorInterface;
  }): Promise<T[]> {
    const query = this.neo4j.initQuery({ serialiser: params.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
    };

    const validator = (): string => params.cypherService.userHasAccess({ useTotalScore: true });

    // Same shape as `_findRelevant`: the page is cut after the access check, so a
    // page is filled from rows the caller may read and the pagination total (the
    // query up to {CURSOR}) counts the same rows. `WITH *` gives ORDER BY a
    // projection to attach to whatever the access check emits.
    query.query += `${authorQuery({ deferCursor: true })}
        WITH content as ${params.model.nodeName}, totalScore
        OPTIONAL MATCH (${params.model.nodeName})-[:AUTHORED_BY]->(${params.model.nodeName}_author:User)
        WHERE ${params.model.nodeName}_author.id <> $id
        ${query.queryParams.companyId ? `MATCH (company:Company {id: $companyId})` : ``}
        ${
          query.queryParams.currentUserId
            ? query.queryParams.companyId
              ? `MATCH (currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company)`
              : `MATCH (currentUser:User {id: $currentUserId})`
            : ``
        }

        ${this.securityService.userHasAccess({ validator: validator })}
        WITH *
        ORDER BY totalScore DESC
        {CURSOR}
        ${params.cypherService.returnStatement({ useTotalScore: true })}
    `;

    return this.neo4j.readMany(query);
  }

  async findByUser<T>(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    id: string;
    cursor: JsonApiCursorInterface;
  }): Promise<T[]> {
    return this._findRelevantByAuthor({
      model: params.model,
      cypherService: params.cypherService,
      id: params.id,
      type: "User",
      cursor: params.cursor,
    });
  }

  async findById<T>(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    id: string;
    cursor: JsonApiCursorInterface;
  }): Promise<T[]> {
    return this._findRelevant({
      model: params.model,
      cypherService: params.cypherService,
      id: params.id,
      cursor: params.cursor,
    });
  }

  async findUsersById(params: { cypherService: any; id: string; cursor: JsonApiCursorInterface }): Promise<User[]> {
    await this.assertSourceAccessible({ id: params.id });

    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
    };

    query.query += `
      ${contentToAuthorQuery({ sourceLabels: this.getContentLabels() })}
      WITH author as user, totalScore
      RETURN user, totalScore
    `;

    return this.neo4j.readMany(query);
  }
}
