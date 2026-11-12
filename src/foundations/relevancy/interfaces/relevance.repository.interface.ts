import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { SortCriterion } from "../../../core/neo4j/types/filter.criterion";

export interface RelevanceRepositoryInterface<T> {
  findByUser(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    id: string;
    cursor: JsonApiCursorInterface;
  }): Promise<T[]>;

  findById(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    id: string;
    cursor: JsonApiCursorInterface;
    /** Validated sort; replaces the relevance ranking while set. */
    orderByFields?: SortCriterion[];
  }): Promise<T[]>;
}
