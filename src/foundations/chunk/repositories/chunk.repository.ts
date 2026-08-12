import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { buildEmbedderAttribution } from "../../../agents/common/usage-attribution";
import { AiStatus } from "../../../common/enums/ai.status";
import { unwrapNeo4jIntegers } from "../../../common/helpers/unwrap-neo4j-integer";
import { AI_SOURCE_QUERY, AiSourceQueryProvider } from "../../../common/repositories/ai-source-query.provider";
import { DataLimits } from "../../../common/types/data.limits";
import { EmbedderAttribution, EmbedderService } from "../../../core";
import { ModelService } from "../../../core/llm/services/model.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Chunk, ChunkDescriptor } from "../../chunk/entities/chunk.entity";
import { chunkMeta } from "../entities/chunk.meta";
import { reciprocalRankFusion } from "../services/reciprocal-rank-fusion";

@Injectable()
export class ChunkRepository implements OnModuleInit {
  /**
   * Chunks embedded (and written) per round-trip in `enrichContentAndEmbedBatch`.
   * A whole document's worth of vectors held at once is what pushed the worker past
   * its heap on large uploads: 760 pages ≈ 2.5k chunks × 3072 floats. Slicing bounds
   * the peak to one slice's vectors while keeping batching's latency win (one embedder
   * call per 50 chunks, not per chunk).
   */
  private static readonly EMBED_SLICE = 50;

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

  /**
   * `attribution` is OPTIONAL and opt-in: this is a QUERY-time embedding, so
   * the repository has no entity of its own to bill it to. The retrieval scope
   * lives with the caller (the contextualiser knows which content the run is
   * bound to), which is why it is passed down rather than derived here. Absent,
   * `EmbedderService.persistUsage` records nothing.
   */
  async findPotentialChunks(params: {
    question: string;
    dataLimits: DataLimits;
    attribution?: EmbedderAttribution;
  }): Promise<Chunk[]> {
    const queryEmbedding = await this.embedderService.vectoriseText({
      text: params.question,
      attribution: params.attribution,
    });

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

  /**
   * Pipeline hydration of a content node's chunks — deliberately WITHOUT `embedding`.
   *
   * A :Chunk node carries a full embedding vector (3072 floats ≈ 24 KB raw, far more
   * once the driver has boxed it). Returning the whole node made every pipeline guard
   * pull the entire document's vectors into the worker heap even though NO consumer
   * reads `chunk.embedding` — that is what killed the worker on a 760-page matrix.
   *
   * The rows are therefore returned as an explicit `{ labels, properties }` map instead
   * of a Node: `EntityFactory.createOrMerge` treats any column with a `labels` key as a
   * node and maps `data.properties`, so a hand-built map of the same shape hydrates
   * identically (a bare map projection would NOT — it has no `labels`/`properties` and
   * the factory would drop the row).
   *
   * The projected property list is exactly the descriptor's own fields (minus
   * `embedding`) plus the `Entity` base fields, so nothing is lost: the descriptor's
   * auto-generated mapper only ever reads those keys anyway.
   */
  async findChunks(params: { id: string; nodeType: string }): Promise<Chunk[]> {
    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
    };

    query.query += `
      MATCH (:${params.nodeType} {id: $id})-[:HAS_CHUNK]->(chunkNode:Chunk)
      WITH chunkNode
      ORDER BY chunkNode.position
      RETURN {
        labels: labels(chunkNode),
        properties: chunkNode {
          .id,
          .content,
          .heading,
          .position,
          .aiStatus,
          .nodeId,
          .nodeType,
          .imagePath,
          .dates,
          .propagatedDates,
          .createdAt,
          .updatedAt
        }
      } AS chunk
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

    // Ingestion-time embedding: the chunk being created belongs to `nodeId`, so
    // the spend is billed to that entity. `nodeType` is already the Neo4j label
    // the Cypher below interpolates; `buildEmbedderAttribution` normalises it
    // through the registry so a caller holding the JSON:API type still bills to
    // the label the `USED_FOR` edge is matched on.
    const vector = await this.embedderService.vectoriseText({
      text: params.content,
      attribution: buildEmbedderAttribution({ entityId: params.nodeId, entityIdentifier: params.nodeType }),
    });

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

  /**
   * `attribution` is OPTIONAL (added second, positionally, so existing callers
   * keep compiling). One usage record is written per embedded slice — see
   * `EmbedderService.persistUsage`. That is honest here because every item in
   * the batch is a chunk of the SAME parent entity: the only caller,
   * `ChunkService.propagateAndEmbedDates`, builds `items` from
   * `findChunks({ id, nodeType })`.
   */
  async enrichContentAndEmbedBatch(
    items: { chunkId: string; enrichedContent: string; propagatedDates?: string }[],
    attribution?: EmbedderAttribution,
  ): Promise<void> {
    // Also the zero-token guard: an empty batch embeds nothing, and an operation
    // that records ZERO tokens must record NOTHING. `persistUsage` has no
    // zero-token guard of its own, so returning here is what prevents a
    // 0-token/0-cost row now that this site supplies an attribution.
    if (items.length === 0) return;

    for (let start = 0; start < items.length; start += ChunkRepository.EMBED_SLICE) {
      // Everything below is scoped to this iteration, so the previous slice's vectors
      // and rows become unreachable as soon as the next slice starts.
      const slice = items.slice(start, start + ChunkRepository.EMBED_SLICE);

      // One Azure round-trip per slice — per-call latency dominates batch size, so
      // embedding chunks individually (vectoriseText per chunk) is far slower.
      // RateLimitedEmbedder.embedDocuments splits internally if the slice exceeds maxBatchTokens.
      // `attribution` is optional: without it the embedder records no usage (opt-in by design).
      // Attribution is forwarded per slice: each slice's usage record carries its own
      // token count, so the totals are identical to the single-batch version.
      const vectors = await this.embedderService.vectoriseTextBatch(
        slice.map((item) => item.enrichedContent),
        attribution,
      );

      const rows = slice.map((item, index) => ({
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

  /**
   * Count of chunks not yet completed for a content node. Replaces full hydration in
   * pipeline guards: they only ever asked "are any chunks still pending?", and hydrating
   * every chunk (embedding vectors included) to answer it is what made the guard
   * quadratic in a document's chunk count.
   *
   * Returns a scalar, so it cannot go through `readOne`/`readMany` (those map entity
   * columns). Same raw-scalar read as `TokenUsageRepository.findUsageSummary` — the
   * package's precedent for non-entity aggregate reads.
   */
  async countChunksInProgress(params: { id: string; nodeType: string }): Promise<number> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      aiStatus: [AiStatus.InProgress, AiStatus.Pending],
    };

    query.query += `
      MATCH (:${params.nodeType} {id: $id})-[:HAS_CHUNK]->(chunk:Chunk)
      WHERE chunk.aiStatus IN $aiStatus
      RETURN count(chunk) AS count
    `;

    const result = await this.neo4j.read(query.query, query.queryParams);
    if (result.records.length === 0) return 0;

    // Cypher `count()` arrives as a neo4j-driver Integer; the package's own unwrap helper
    // turns it into a plain JS number (and passes real numbers through untouched).
    const count = unwrapNeo4jIntegers<number | null>(result.records[0].get("count"));
    return count ?? 0;
  }

  /**
   * Single-winner claim on a content node's post-chunking pipeline.
   *
   * `countChunksInProgress` alone CANNOT gate finalisation. It answers "are any chunks
   * still pending?", never "has finalisation already run?", and `ChunkService.generateGraph`
   * enqueues one finalise job per chunk — so a 25-chunk document gets 25 jobs. Once the last
   * chunk lands, every remaining queued job passes a pending-count check and re-runs the whole
   * pipeline (measured 2026-08-12: summariser ran 25× on one document, 100.91 credits; ~70% of
   * that run's spend was duplicated work).
   *
   * The `SET n.finalisationClaimedAt = n.finalisationClaimedAt` is a deliberate no-op write: it
   * takes the node's write lock BEFORE the predicate is evaluated. A concurrent claimer blocks
   * there, and re-reads the committed value afterwards (Neo4j reads are read-committed, not
   * repeatable), so it sees the winner's timestamp and its `WHERE` fails. Without the lock both
   * transactions evaluate the predicate on the pre-write state and both claim.
   *
   * Re-ingestion re-arms the claim via `clearFinalisationClaim` in `ChunkService.createChunks`.
   */
  async claimContentFinalisation(params: { id: string; nodeType: string }): Promise<boolean> {
    const query = this.neo4j.initQuery();

    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      pendingStatus: [AiStatus.InProgress, AiStatus.Pending],
    };

    query.query += `
      MATCH (nodeType:${params.nodeType} {id: $id})
      SET nodeType.finalisationClaimedAt = nodeType.finalisationClaimedAt
      WITH nodeType
      WHERE nodeType.finalisationClaimedAt IS NULL
        AND NOT EXISTS {
          MATCH (nodeType)-[:HAS_CHUNK]->(chunk:Chunk)
          WHERE chunk.aiStatus IN $pendingStatus
        }
      SET nodeType.finalisationClaimedAt = datetime()
      RETURN nodeType.id AS id
    `;

    // `executeInTransaction` (not `writeOne`) because the claim must READ its own outcome:
    // `writeOne` returns null without a serialiser, and the lock has to be held for the whole
    // transaction for the re-read to be meaningful. Same id-keyed, label-scoped match as
    // `countChunksInProgress` above — no company scope, by design: this is an internal
    // pipeline latch keyed on a UUID the caller already resolved.
    const [result] = await this.neo4j.executeInTransaction([{ query: query.query, params: query.queryParams }]);

    return result.records.length > 0;
  }

  /**
   * Re-arms `claimContentFinalisation` for a content node whose chunks are being (re)built.
   * Called from `ChunkService.createChunks`, the single entry point every ingestion and
   * rebuild path goes through — without it a re-ingested document would keep the stale claim
   * and skip finalisation silently.
   */
  async clearFinalisationClaim(params: { id: string; nodeType: string }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, id: params.id };
    query.query += `
      MATCH (nodeType:${params.nodeType} {id: $id})
      REMOVE nodeType.finalisationClaimedAt
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
