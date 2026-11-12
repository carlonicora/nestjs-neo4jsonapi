import { Injectable } from "@nestjs/common";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { getContentModel } from "../../content/entities/content";
import { ContentRepository } from "../../content/repositories/content.repository";
import { JsonApiListDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { parseJsonApiSort } from "../../../core/neo4j/helpers/parse-jsonapi-sort";

/**
 * The content fields a list request may sort by (Content has no descriptor of its own, so the
 * allow-list lives here). `createdAt` / `updatedAt` are always accepted.
 */
export const CONTENT_SORTABLE_FIELDS: readonly string[] = ["name"];

@Injectable()
export class ContentService {
  constructor(
    private readonly builder: JsonApiService,
    private readonly contentRepository: ContentRepository,
  ) {}

  async find(params: {
    query: any;
    term?: string;
    fetchAll?: boolean;
    /** Legacy single-field order; ignored when `sort` is present. */
    orderBy?: string;
    /** JSON:API `sort`, validated against {@link CONTENT_SORTABLE_FIELDS} (400 otherwise); wins over `orderBy`. */
    sort?: string;
  }): Promise<JsonApiListDocument> {
    const orderByFields = parseJsonApiSort({ sort: params.sort, allow: CONTENT_SORTABLE_FIELDS });
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      getContentModel(),
      await this.contentRepository.find({
        fetchAll: params.fetchAll,
        term: params.term,
        orderBy: orderByFields ? undefined : params.orderBy,
        orderByFields,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async findByIds(params: {
    contentIds: string[];
    /** JSON:API `sort`, validated against {@link CONTENT_SORTABLE_FIELDS} (400 otherwise). */
    sort?: string;
  }): Promise<JsonApiListDocument> {
    const orderByFields = parseJsonApiSort({ sort: params.sort, allow: CONTENT_SORTABLE_FIELDS });

    return this.builder.buildList(
      getContentModel(),
      await this.contentRepository.findByIds({
        contentIds: params.contentIds,
        orderByFields,
      }),
    );
  }

  async findByOwner(params: {
    ownerId: string;
    query: any;
    term?: string;
    fetchAll?: boolean;
    /** Legacy single-field order; ignored when `sort` is present. */
    orderBy?: string;
    /** JSON:API `sort`, validated against {@link CONTENT_SORTABLE_FIELDS} (400 otherwise); wins over `orderBy`. */
    sort?: string;
  }): Promise<JsonApiListDocument> {
    const orderByFields = parseJsonApiSort({ sort: params.sort, allow: CONTENT_SORTABLE_FIELDS });
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      getContentModel(),
      await this.contentRepository.findByOwner({
        ownerId: params.ownerId,
        fetchAll: params.fetchAll,
        term: params.term,
        orderBy: orderByFields ? undefined : params.orderBy,
        orderByFields,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }
}
