import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { AI_SOURCE_QUERY, AiSourceQueryProvider } from "../../../common/repositories/ai-source-query.provider";
import { DataLimits } from "../../../common/types/data.limits";
import { EmbedderService } from "../../../core";
import { ModelService } from "../../../core/llm/services/model.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Chunk, ChunkDescriptor } from "../../chunk/entities/chunk.entity";
import { chunkMeta } from "../entities/chunk.meta";
import { reciprocalRankFusion } from "../services/reciprocal-rank-fusion";

@Injectable()
export class ChunkRepository implements OnModuleInit {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly modelService: ModelService,
    private readonly embedderService: EmbedderService,
    private readonly clsService: ClsService,
    private readonly securityService: SecurityService,
    @Inject(AI_SOURCE_QUERY) private readonly aiSourceQuery: AiSourceQueryProvider,
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

    await this.neo4j.writeOne({
      query: `CREATE FULLTEXT INDEX chunk_content_search IF NOT EXISTS FOR (chunk:Chunk) ON EACH [chunk.content]`,
    });
  }

  async recreateVectorIndex(): Promise<void> {
    await this.neo4j.writeOne({
      query: `DROP INDEX chunks IF EXISTS`,
    });

    const dimensions = this.modelService.getEmbedderDimensions();
    await this.neo4j.writeOne({
      query: `
        CREATE VECTOR INDEX chunks IF NOT EXISTS
        FOR (chunk:Chunk)
        ON chunk.embedding
        OPTIONS { indexConfig: {
        \`vector.dimensions\`: ${dimensions},
        \`vector.similarity_function\`: 'cosine'
        }};
        `,
    });
  }

  async findAllChunks(): Promise<Chunk[]> {
    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model, fetchAll: true });
    query.query = `
        MATCH (${chunkMeta.nodeName}:${chunkMeta.labelName})
        RETURN ${chunkMeta.nodeName}
      `;

    return this.neo4j.readMany(query);
  }

  async updateEmbedding(params: { chunkId: string; embedding: number[] }): Promise<void> {
    await this.neo4j.writeOne({
      query: `
        MATCH (chunk:Chunk {id: $chunkId})
        SET chunk.embedding = $embedding, chunk.updatedAt = datetime()
      `,
      queryParams: {
        chunkId: params.chunkId,
        embedding: params.embedding,
      },
    });
  }

  async findPotentialChunks(params: { question: string; dataLimits: DataLimits }): Promise<Chunk[]> {
    const queryEmbedding = await this.embedderService.vectoriseText({ text: params.question });

    // Lucene special-character escape so user questions can't break the fulltext query.
    const term = params.question.replace(/([+\-!(){}\[\]^"~*?:\\\/]|&&|\|\|)/g, "\\$1");

    // The access-scoped id-set both retrieval branches are filtered to.
    const scope = this.aiSourceQuery.build({
      dataLimits: params.dataLimits,
      currentUserId: this.clsService.get("userId"),
      securityService: this.securityService,
      returnsData: true,
    });
    const scopeQuery = this.neo4j.initQuery();
    scopeQuery.queryParams = { ...scopeQuery.queryParams, ...scope.params };
    scopeQuery.query += `
        ${scope.cypher}
        MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(data)
        RETURN COLLECT(DISTINCT chunk.id) AS chunkIds
      `;

    const scopeResult = await this.neo4j.read(scopeQuery.query, scopeQuery.queryParams);
    const chunkIds = (scopeResult.records[0]?.get("chunkIds") as string[]) ?? [];

    if (chunkIds.length === 0) return [];

    const vectorResult = await this.neo4j.read(
      `
        CALL db.index.vector.queryNodes('chunks', 1000, $queryEmbedding)
        YIELD node AS candidateChunk, score
        WHERE candidateChunk.id IN $chunkIds
        RETURN candidateChunk.id AS id
        ORDER BY score DESC
        LIMIT 50
      `,
      { queryEmbedding, chunkIds },
    );
    const vectorIds = vectorResult.records.map(
      (record: { get: (key: string) => unknown }) => record.get("id") as string,
    );

    let lexicalIds: string[] = [];
    if (term.trim()) {
      const lexicalResult = await this.neo4j.read(
        `
          CALL db.index.fulltext.queryNodes('chunk_content_search', $term)
          YIELD node, score
          WHERE node.id IN $chunkIds
          RETURN node.id AS id
          ORDER BY score DESC
          LIMIT 50
        `,
        { term, chunkIds },
      );
      lexicalIds = lexicalResult.records.map((record: { get: (key: string) => unknown }) => record.get("id") as string);
    }

    const fusedIds = reciprocalRankFusion([vectorIds, lexicalIds]).slice(0, 20);

    return this.findChunksByIdsOrdered(fusedIds);
  }

  private async findChunksByIdsOrdered(ids: string[]): Promise<Chunk[]> {
    if (ids.length === 0) return [];

    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });
    query.queryParams = {
      ...query.queryParams,
      ids,
    };

    query.query += `
      MATCH (chunk:Chunk)
      WHERE chunk.id IN $ids
      RETURN chunk
    `;

    const chunks = await this.neo4j.readMany(query);
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    return ids.map((id) => byId.get(id)).filter((chunk): chunk is Chunk => chunk !== undefined);
  }

  async findParentName(params: { id: string; nodeType: string }): Promise<string | undefined> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, id: params.id };
    query.query = `
      MATCH (n:${params.nodeType} {id: $id})
      RETURN coalesce(n.name, n.title, n.subject, n.number) AS name
    `;
    const result = await this.neo4j.read(query.query, query.queryParams);
    const name = result.records[0]?.get("name");
    return typeof name === "string" && name.trim() ? name : undefined;
  }

  async findSubsequentChunkId(params: { chunkId: string }): Promise<Chunk> {
    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      chunkId: params.chunkId,
    };

    query.query += `
        MATCH (current:Chunk {id: $chunkId})-[:NEXT]->(chunk:Chunk)
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
        MATCH (current:Chunk {id: $chunkId})<-[:NEXT]-(chunk:Chunk)
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
      MATCH (chunk:Chunk {id: $chunkId})
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
      MATCH (chunk_type:${params.nodeType} {id: $id})-[:HAS_CHUNK]->(chunk:Chunk)
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
    heading?: string;
    imagePath?: string;
    position: number;
  }): Promise<void> {
    const query = this.neo4j.initQuery();

    const vector = await this.embedderService.vectoriseText({ text: params.content });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      content: params.content,
      heading: params.heading ?? null,
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
      OPTIONAL MATCH (nodeType)-[:BELONGS_TO]->(company)
      CREATE (chunk:Chunk {
        id: $id,
        content: $content,
        heading: $heading,
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

  async updateDates(params: { chunkId: string; dates: string }): Promise<void> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      chunkId: params.chunkId,
      dates: params.dates,
    };

    query.query = `
      MATCH (chunk:Chunk {id: $chunkId})
      SET chunk.dates = $dates, chunk.updatedAt = datetime()
    `;

    await this.neo4j.writeOne(query);
  }

  async enrichContentAndEmbedBatch(
    items: { chunkId: string; enrichedContent: string; propagatedDates?: string }[],
  ): Promise<void> {
    if (items.length === 0) return;

    // One Azure round-trip for the whole set — per-call latency dominates batch size, so
    // embedding chunks individually (vectoriseText per chunk) is far slower than batching.
    // RateLimitedEmbedder.embedDocuments splits internally if the batch exceeds maxBatchTokens.
    const vectors = await this.embedderService.vectoriseTextBatch(items.map((item) => item.enrichedContent));

    const rows = items.map((item, index) => ({
      chunkId: item.chunkId,
      enrichedContent: item.enrichedContent,
      vector: vectors[index],
      propagatedDates: item.propagatedDates ?? null,
    }));

    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      rows,
    };

    query.query = `
      UNWIND $rows AS row
      MATCH (chunk:Chunk {id: row.chunkId})
      SET chunk.content = row.enrichedContent,
          chunk.embedding = row.vector,
          chunk.updatedAt = datetime(),
          chunk.propagatedDates = row.propagatedDates
    `;

    await this.neo4j.writeOne(query);
  }

  async markChunksCompleted(params: { id: string; nodeType: string }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, id: params.id, aiStatus: AiStatus.Completed };
    query.query += `
      MATCH (nodeType:${params.nodeType} {id: $id})-[:HAS_CHUNK]->(chunk:Chunk)
      SET chunk.aiStatus = $aiStatus, chunk.updatedAt = datetime()
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

  async findChunkNeighbors(params: {
    chunkIds: string[];
    window: number;
  }): Promise<{ chunkId: string; before: string[]; after: string[] }[]> {
    if (params.chunkIds.length === 0) return [];
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, chunkIds: params.chunkIds, window: params.window };
    query.query = `
      UNWIND $chunkIds AS cid
      MATCH (c:Chunk {id: cid})
      OPTIONAL MATCH pBefore = (b:Chunk)-[:NEXT*1..]->(c)
      WITH cid, c, b, length(pBefore) AS beforeDist ORDER BY beforeDist ASC
      WITH cid, c, [x IN collect(b) WHERE x IS NOT NULL][0..$window] AS befores
      OPTIONAL MATCH pAfter = (c)-[:NEXT*1..]->(a:Chunk)
      WITH cid, befores, a, length(pAfter) AS afterDist ORDER BY afterDist ASC
      WITH cid, befores, [x IN collect(a) WHERE x IS NOT NULL][0..$window] AS afters
      RETURN cid AS chunkId, [x IN befores | x.content] AS before, [x IN afters | x.content] AS after
    `;
    const result = await this.neo4j.read(query.query, query.queryParams);
    return result.records.map((r: { get: (k: string) => unknown }) => ({
      chunkId: r.get("chunkId") as string,
      before: (r.get("before") as string[]) ?? [],
      after: (r.get("after") as string[]) ?? [],
    }));
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
