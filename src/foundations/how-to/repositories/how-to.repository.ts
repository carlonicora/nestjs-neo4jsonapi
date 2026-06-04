import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { HowTo, HowToDescriptor } from "../entities/how-to";
import { howToMeta } from "../entities/how-to.meta";

@Injectable()
export class HowToRepository extends AbstractRepository<HowTo, typeof HowToDescriptor.relationships> {
  protected readonly descriptor = HowToDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Update the AI processing status of a HowTo
   */
  async updateStatus(params: { id: string; aiStatus: AiStatus }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      aiStatus: params.aiStatus,
    };

    query.query = `
      MATCH (${howToMeta.nodeName}:${howToMeta.labelName} {id: $id})
      SET ${howToMeta.nodeName}.aiStatus = $aiStatus, ${howToMeta.nodeName}.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  /**
   * Published help articles (draft = false), optionally filtered by type, ordered.
   * Unpaginated by design — the docs corpus is a small bounded set.
   * buildDefaultMatch() + readMany, no access check
   * (HowTo is not company-scoped; public reads have no CLS user).
   */
  async findPublished(params: { howToType?: string }): Promise<HowTo[]> {
    const query = this.neo4j.initQuery({ serialiser: HowToDescriptor.model });
    query.queryParams = {
      ...query.queryParams,
      ...(params.howToType ? { howToType: params.howToType } : {}),
    };
    query.query = `
      ${this.buildDefaultMatch()}
      WHERE (${howToMeta.nodeName}.draft IS NULL OR ${howToMeta.nodeName}.draft = false)
      ${params.howToType ? `AND ${howToMeta.nodeName}.howToType = $howToType` : ""}
      ORDER BY ${howToMeta.nodeName}.order ASC, ${howToMeta.nodeName}.name ASC
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * Single published article by type + slug.
   */
  async findPublishedByTypeAndSlug(params: { howToType: string; slug: string }): Promise<HowTo | null> {
    const query = this.neo4j.initQuery({ serialiser: HowToDescriptor.model });
    query.queryParams = { ...query.queryParams, howToType: params.howToType, slug: params.slug };
    query.query = `
      ${this.buildDefaultMatch()}
      WHERE ${howToMeta.nodeName}.howToType = $howToType
        AND ${howToMeta.nodeName}.slug = $slug
        AND (${howToMeta.nodeName}.draft IS NULL OR ${howToMeta.nodeName}.draft = false)
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readOne(query);
  }

  /**
   * Published articles RELATED to the given article id (undirected — a single stored
   * directed edge reads symmetrically). Custom multi-hop method; the canonical graph
   * answer to "see also", NOT a self-referential descriptor relationship.
   */
  async findRelated(params: { howToId: string }): Promise<HowTo[]> {
    const query = this.neo4j.initQuery({ serialiser: HowToDescriptor.model });
    query.queryParams = { ...query.queryParams, howToId: params.howToId };
    query.query = `
      ${this.buildDefaultMatch()}
      MATCH (${howToMeta.nodeName})-[:RELATED]-(origin:${howToMeta.labelName} {id: $howToId})
      WHERE (${howToMeta.nodeName}.draft IS NULL OR ${howToMeta.nodeName}.draft = false)
      ORDER BY ${howToMeta.nodeName}.order ASC, ${howToMeta.nodeName}.name ASC
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  /**
   * Store a RELATED edge (single directed; read undirected by findRelated).
   */
  async addRelated(params: { howToId: string; relatedId: string }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, howToId: params.howToId, relatedId: params.relatedId };
    query.query = `
      MATCH (a:${howToMeta.labelName} {id: $howToId})
      MATCH (b:${howToMeta.labelName} {id: $relatedId})
      MERGE (a)-[:RELATED]->(b)
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Remove a RELATED edge regardless of stored direction.
   */
  async removeRelated(params: { howToId: string; relatedId: string }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, howToId: params.howToId, relatedId: params.relatedId };
    query.query = `
      MATCH (a:${howToMeta.labelName} {id: $howToId})-[r:RELATED]-(b:${howToMeta.labelName} {id: $relatedId})
      DELETE r
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Every HowTo, unpaginated — used by the reindex pass.
   */
  async findAllHowTos(): Promise<HowTo[]> {
    const query = this.neo4j.initQuery({ serialiser: HowToDescriptor.model });
    query.query = `
      ${this.buildDefaultMatch()}
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }
}
