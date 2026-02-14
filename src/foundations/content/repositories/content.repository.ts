import { Document } from "@langchain/core/documents";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { modelRegistry } from "../../../common/registries/registry";
import { BaseConfigInterface, ConfigContentTypesInterface } from "../../../config/interfaces";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Content } from "../../content/entities/content.entity";
import { contentMeta } from "../../content/entities/content.meta";
import { ContentCypherService } from "../../content/services/content.cypher.service";
import { ownerMeta } from "../../user/entities/user.meta";

@Injectable()
export class ContentRepository {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly contentCypherService: ContentCypherService,
    private readonly securityService: SecurityService,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {}

  private getContentTypes(): string[] {
    const types = this.configService.get<ConfigContentTypesInterface>("contentTypes")?.types ?? [];
    return types.length > 0 ? types : [contentMeta.labelName];
  }

  /**
   * Get the ContentModel from registry (may be extended with additional childrenTokens)
   */
  private getContentModel(): DataModelInterface<Content> {
    const model = modelRegistry.get(contentMeta.nodeName);
    if (!model) {
      throw new Error(`ContentModel not found in registry for nodeName: ${contentMeta.nodeName}`);
    }
    return model as DataModelInterface<Content>;
  }

  async find(params: {
    fetchAll?: boolean;
    term?: string;
    orderBy?: string;
    cursor?: JsonApiCursorInterface;
  }): Promise<Content[]> {
    const query = this.neo4j.initQuery({
      cursor: params.cursor,
      serialiser: this.getContentModel(),
      fetchAll: params.fetchAll,
    });

    query.queryParams = {
      ...query.queryParams,
      term: params.term,
    };

    query.query += `
      ${this.contentCypherService.default()}
      ${this.securityService.userHasAccess({ validator: this.contentCypherService.userHasAccess })}

      ORDER BY ${contentMeta.nodeName}.${params.orderBy ? `${params.orderBy}` : `updatedAt DESC`}
      {CURSOR}

      ${this.contentCypherService.returnStatement()}
    `;

    return this.neo4j.readMany(query);
  }

  async findByIds(params: { contentIds: string[] }): Promise<Document[]> {
    const query = this.neo4j.initQuery({ serialiser: this.getContentModel() });

    query.queryParams = {
      ...query.queryParams,
      ids: params.contentIds,
    };

    query.query += `
        MATCH (${contentMeta.nodeName}:${this.getContentTypes().join("|")})-[:BELONGS_TO]->(company)
        WHERE ${contentMeta.nodeName}.id IN $ids 
        AND ${contentMeta.nodeName}.tldr IS NOT NULL
        AND ${contentMeta.nodeName}.tldr <> ""
        ${this.securityService.userHasAccess({ validator: this.contentCypherService.userHasAccess })}
        ${this.contentCypherService.returnStatement()}
      `;

    return this.neo4j.readMany(query);
  }

  async findByOwner(params: {
    ownerId: string;
    term?: string;
    orderBy?: string;
    fetchAll?: boolean;
    cursor?: JsonApiCursorInterface;
  }) {
    const query = this.neo4j.initQuery({
      serialiser: this.getContentModel(),
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
      
      ORDER BY ${contentMeta.nodeName}.${params.orderBy ? `${params.orderBy}` : `updatedAt DESC`}
      MATCH (${contentMeta.nodeName})<-[:PUBLISHED]-(:${ownerMeta.labelName} {id: $ownerId})
      {CURSOR}

      ${this.contentCypherService.returnStatement()}
    `;

    return this.neo4j.readMany(query);
  }
}
