import { Injectable } from "@nestjs/common";
import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { RelevanceRepositoryInterface } from "../../relevancy/interfaces/relevance.repository.interface";
import { authorQuery, contentQuery, contentToAuthorQuery } from "../../relevancy/queries/relevance";
import { UserDescriptor, User } from "../../user";

@Injectable()
export class RelevancyRepository<T> implements RelevanceRepositoryInterface<T> {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly securityService: SecurityService,
  ) {}

  private async _findRelevant<T>(params: {
    model: DataModelInterface<T>;
    cypherService: any;
    id: string;
    type?: string;
    cursor?: JsonApiCursorInterface;
  }): Promise<T[]> {
    const query = this.neo4j.initQuery({ serialiser: params.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
    };

    const validator = (): string => params.cypherService.userHasAccess({ useTotalScore: true });

    query.query += `${contentQuery({})}
      WITH content as ${params.model.nodeName}, totalScore
      WHERE ${params.model.nodeName}.id <> "${params.id}"
      AND totalScore > 20

      ${this.securityService.userHasAccess({ validator: validator })}
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

    query.query += `${authorQuery({})}
        WITH content as ${params.model.nodeName}, totalScore
        OPTIONAL MATCH (${params.model.nodeName})-[:AUTHORED_BY]->(${params.model.nodeName}_author:User)
        WHERE ${params.model.nodeName}_author.id <> $id

        ${this.securityService.userHasAccess({ validator: validator })}
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
    const query = this.neo4j.initQuery({ serialiser: UserDescriptor.model, cursor: params.cursor });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
    };

    query.query += `
      ${contentToAuthorQuery({})}
      WITH author as user, totalScore
      RETURN user, totalScore
    `;

    return this.neo4j.readMany(query);
  }
}
