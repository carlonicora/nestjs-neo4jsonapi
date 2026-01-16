import { Injectable } from "@nestjs/common";
import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { RelevanceServiceInterface } from "../../relevancy/interfaces/relevance.service.interface";
import { RelevancyRepository } from "../../relevancy/repositories/relevancy.repository";
import { UserDescriptor } from "../../user";

@Injectable()
export class RelevancyService<T> implements RelevanceServiceInterface {
  constructor(
    private readonly builder: JsonApiService,
    private readonly relevancyRepository: RelevancyRepository<T>,
  ) {}

  private async _findRelevant<T>(params: {
    function: (params: {
      model: DataModelInterface<T>;
      cypherService: any;
      id: string;
      cursor: JsonApiCursorInterface;
    }) => Promise<T[]>;
    model: DataModelInterface<T>;
    cypherService: any;
    type?: string;
    id: string;
    query?: any;
  }): Promise<JsonApiDataInterface> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      params.model,
      await params.function({
        model: params.model,
        cypherService: params.cypherService,
        id: params.id,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  async findRelevantByUser<T>(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    userId: string;
    query?: any;
  }): Promise<JsonApiDataInterface> {
    return this._findRelevant({
      function: (args) => this.relevancyRepository.findByUser(args),
      model: params.model,
      cypherService: params.cypherService,
      type: "User",
      id: params.userId,
      query: params.query,
    });
  }

  async findRelevant<T>(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    id: string;
    query?: any;
  }): Promise<JsonApiDataInterface> {
    return this._findRelevant({
      function: (args) => this.relevancyRepository.findById(args),
      model: params.model,
      cypherService: params.cypherService,
      id: params.id,
      query: params.query,
    });
  }

  async findRelevantUsers(params: { cypherService: any; id: string; query?: any }): Promise<JsonApiDataInterface> {
    const paginator: JsonApiPaginator = new JsonApiPaginator(params.query);

    return this.builder.buildList(
      UserDescriptor.model,
      await this.relevancyRepository.findUsersById({
        cypherService: params.cypherService,
        id: params.id,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }
}
