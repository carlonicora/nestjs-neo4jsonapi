import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Chunk, ChunkDescriptor } from "../entities/chunk.entity";

/**
 * Company-scoped chunk status reads and writes, keyed by many chunks or many owners at once.
 *
 * Chunks have no `BELONGS_TO` edge (only `(owner)-[:HAS_CHUNK]->(chunk)`), so
 * `buildDefaultMatch()` on `ChunkDescriptor` would match nothing. Every query joins
 * explicitly through the owner to the `company` that `initQuery` binds from CLS, so callers
 * (BullMQ jobs) must seed CLS `companyId` first.
 */
@Injectable()
export class ChunkStatusRepository extends AbstractRepository<Chunk, typeof ChunkDescriptor.relationships> {
  protected readonly descriptor = ChunkDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * No schema of its own: `ChunkRepository.onModuleInit` owns the Chunk constraint and
   * indexes. The inherited one would add a fulltext index over every Chunk string field.
   */
  async onModuleInit(): Promise<void> {}

  async markNotGraphed(params: { ids: string[] }): Promise<void> {
    if (params.ids.length === 0) return;

    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      ids: params.ids,
      aiStatus: AiStatus.NotGraphed,
    };

    query.query += `
      MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(owner)-[:BELONGS_TO]->(company)
      WHERE chunk.id IN $ids
      SET chunk.aiStatus = $aiStatus, chunk.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  async findByStatusForContent(params: { contentIds: string[]; aiStatus: AiStatus[] }): Promise<Chunk[]> {
    if (params.contentIds.length === 0) return [];

    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      contentIds: params.contentIds,
      aiStatus: params.aiStatus,
    };

    query.query += `
      MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(owner)-[:BELONGS_TO]->(company)
      WHERE owner.id IN $contentIds AND chunk.aiStatus IN $aiStatus
      RETURN chunk
    `;

    return this.neo4j.readMany(query);
  }
}
