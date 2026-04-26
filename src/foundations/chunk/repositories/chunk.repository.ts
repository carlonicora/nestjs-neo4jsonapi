import { Injectable, OnModuleInit } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { aiSourceQuery } from "../../../common/repositories/ai.source.query";
import { DataLimits } from "../../../common/types/data.limits";
import { EmbedderService } from "../../../core";
import { ModelService } from "../../../core/llm/services/model.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Chunk, ChunkDescriptor } from "../../chunk/entities/chunk.entity";

@Injectable()
export class ChunkRepository implements OnModuleInit {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly modelService: ModelService,
    private readonly embedderService: EmbedderService,
    private readonly clsService: ClsService,
    private readonly securityService: SecurityService,
  ) {}

  async onModuleInit() {
    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (chunk:Chunk) REQUIRE chunk.id IS UNIQUE`,
    });

    const dimensions = this.modelService.getEmbedderDimensions();
    await this.neo4j.writeOne({
      query: `
        CREATE VECTOR INDEX chunks IF NOT EXISTS
        FOR (chunk:Chunk)
        ON chunk.embedding
        OPTIONS { indexConfig: {
        \`vector.dimensions\`:  ${dimensions},
        \`vector.similarity_function\`: 'cosine'
        }};
        `,
    });
  }

  async findPotentialChunks(params: { question: string; dataLimits: DataLimits }): Promise<Chunk[]> {
    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    const queryEmbedding = await this.embedderService.vectoriseText({ text: params.question });

    query.queryParams = {
      ...query.queryParams,
      queryEmbedding,
    };

    query.query = `
        MATCH (data)-[:BELONGS_TO]->(company)
        ${aiSourceQuery({
          currentUserId: this.clsService.get("userId"),
          securityService: this.securityService,
          dataLimits: params.dataLimits,
          returnsData: true,
        })}
        MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(data)
        WITH COLLECT(DISTINCT chunk.id) AS chunkIds

        CALL db.index.vector.queryNodes('chunks', 1000, $queryEmbedding)
        YIELD node AS candidateChunk, score
        WHERE candidateChunk.id IN chunkIds

        RETURN candidateChunk AS chunk, score
        ORDER BY score DESC
        LIMIT 20
      `;

    return this.neo4j.readMany(query);
  }

  async findSubsequentChunkId(params: { chunkId: string }): Promise<Chunk> {
    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      chunkId: params.chunkId,
    };

    query.query += `
        MATCH (company)<-[:BELONGS_TO]-()-[:HAS_CHUNK]->(current:Chunk {id: $chunkId})-[:NEXT]->(chunk:Chunk)
        RETURN chunk
      `;

    return this.neo4j.readOne(query);
  }

  async findPreviousChunkId(params: { chunkId: string }): Promise<Chunk> {
    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      chunkId: params.chunkId,
    };

    query.query += `
        MATCH (company)<-[:BELONGS_TO]-()-[:HAS_CHUNK]->(current:Chunk {id: $chunkId})<-[:NEXT]-(chunk:Chunk)
        RETURN chunk
      `;

    return this.neo4j.readOne(query);
  }

  async findChunkById(params: { chunkId: string }): Promise<Chunk> {
    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      chunkId: params.chunkId,
    };

    query.query += `
      MATCH (company)<-[:BELONGS_TO]-()-[:HAS_CHUNK]->(chunk:Chunk {id: $chunkId})
      RETURN chunk
    `;

    return this.neo4j.readOne(query);
  }

  async findChunks(params: { id: string; nodeType: string }): Promise<Chunk[]> {
    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
    };

    query.query += `
      MATCH (company)<-[:BELONGS_TO]-(chunk_type:${params.nodeType} {id: $id})-[:HAS_CHUNK]->(chunk:Chunk)
      RETURN chunk, chunk_type
      ORDER BY chunk.position
    `;

    return this.neo4j.readMany(query);
  }

  async createChunk(params: {
    id: string;
    nodeId: string;
    nodeType: string;
    previousChunkId?: string;
    content: string;
    imagePath?: string;
    position: number;
  }): Promise<void> {
    const query = this.neo4j.initQuery();

    const vector = await this.embedderService.vectoriseText({ text: params.content });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      content: params.content,
      position: params.position,
      vector: vector,
      imagePath: params.imagePath,
      previousChunkId: params.previousChunkId,
      aiStatus: AiStatus.Pending,
      nodeId: params.nodeId,
      nodeType: params.nodeType,
    };

    query.query += `
      MATCH (nodeType:${params.nodeType} {id: $nodeId})
      MATCH (nodeType)-[:BELONGS_TO]->(company)
      CREATE (chunk:Chunk {
        id: $id,
        content: $content, 
        ${params.imagePath ? "imagePath: $imagePath," : ""}
        embedding: $vector,
        position: $position,
        aiStatus: $aiStatus,
        nodeId: $nodeId,
        nodeType: $nodeType,
        createdAt: datetime(),
        updatedAt: datetime()
      })
      WITH chunk, nodeType
      MERGE (nodeType)-[:HAS_CHUNK]->(chunk)
      ${
        params.previousChunkId
          ? `
          WITH chunk 
          MATCH (previous:Chunk {id: $previousChunkId}) 
          MERGE (previous)-[:NEXT]->(chunk)
        `
          : ``
      }
    `;

    await this.neo4j.writeOne(query);
  }

  async updateStatus(params: { id: string; aiStatus: AiStatus }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      aiStatus: params.aiStatus,
    };

    query.query = `
      MATCH (chunk:Chunk {id: $id})
      SET chunk.aiStatus = $aiStatus, chunk.updatedAt = datetime();
    `;

    await this.neo4j.writeOne(query);
  }

  async getChunksInProgress(params: { id: string; nodeType: string }): Promise<Chunk[]> {
    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      aiStatus: [AiStatus.InProgress, AiStatus.Pending],
    };

    query.query += `
      MATCH (chunk_type:${params.nodeType} {id: $id})-[:HAS_CHUNK]->(chunk:Chunk)
      WHERE chunk.aiStatus IN $aiStatus
      RETURN chunk
    `;

    return this.neo4j.readMany(query);
  }

  async createNextRelationship(params: { chunkId: string; nextChunkId: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      chunkId: params.chunkId,
      nextChunkId: params.nextChunkId,
    };

    query.query = `
      MATCH (chunk:Chunk {id: $chunkId, userId: $userId}), (next:Chunk {id: $nextChunkId, userId: $userId})
      MERGE (chunk)-[:NEXT]->(next)
    `;

    await this.neo4j.writeOne(query);
  }

  async deleteChunks(params: { chunkIds: string[] }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      chunkIds: params.chunkIds,
    };

    query.query = `
      MATCH (chunk: Chunk)
      WHERE chunk.id IN $chunkIds
      DETACH DELETE chunk
    `;

    await this.neo4j.writeOne(query);
  }

  async deleteDisconnectedChunks(): Promise<void> {
    const query = this.neo4j.initQuery();

    query.query = `
      MATCH (chunk:Chunk)
      WHERE NOT (chunk)<-[:HAS_CHUNK]-()
      DETACH DELETE chunk
    `;

    await this.neo4j.writeOne(query);
  }

  async deleteChunksByNodeType(params: { id: string; nodeType: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      id: params.id,
    };

    query.query = `
      MATCH (nodeType:${params.nodeType} {id: $id})-[:HAS_CHUNK]->(chunk:Chunk)
      DETACH DELETE chunk
    `;

    await this.neo4j.writeOne(query);
  }

  async findChunkByContentIdAndType(params: { id: string; type: string }): Promise<Chunk[]> {
    const query = this.neo4j.initQuery({ fetchAll: true, serialiser: ChunkDescriptor.model });

    query.queryParams = {
      id: params.id,
      nodeType: params.type,
    };

    query.query = `
      MATCH (node:${params.type} {id: $id})-[:HAS_CHUNK]->(chunk:Chunk)
      RETURN chunk
    `;

    return this.neo4j.readMany(query);
  }
}
