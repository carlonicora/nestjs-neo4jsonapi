import { Injectable } from "@nestjs/common";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { getContentModel } from "../../content/entities/content";
import { ContentRepository } from "../../content/repositories/content.repository";

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
    orderBy?: string;
  }): Promise<JsonApiDataInterface> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      getContentModel(),
      await this.contentRepository.find({
        fetchAll: params.fetchAll,
        term: params.term,
        orderBy: params.orderBy,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async findByIds(params: { contentIds: string[] }): Promise<JsonApiDataInterface> {
    return this.builder.buildList(
      getContentModel(),
      await this.contentRepository.findByIds({
        contentIds: params.contentIds,
      }),
    );
  }

  async findByOwner(params: { ownerId: string; query: any; term?: string; fetchAll?: boolean; orderBy?: string }) {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      getContentModel(),
      await this.contentRepository.findByOwner({
        ownerId: params.ownerId,
        fetchAll: params.fetchAll,
        term: params.term,
        orderBy: params.orderBy,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }
}
