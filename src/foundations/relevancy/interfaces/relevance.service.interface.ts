import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { JsonApiListDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";

export interface RelevanceServiceInterface {
  findRelevantByUser<T>(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    userId: string;
    query?: any;
  }): Promise<JsonApiListDocument>;

  findRelevant<T>(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    id: string;
    query?: any;
  }): Promise<JsonApiListDocument>;
}
