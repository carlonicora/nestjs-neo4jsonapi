import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { buildEmbedderAttribution } from "../../../agents/common/usage-attribution";
import { AiStatus } from "../../../common/enums/ai.status";
import { unwrapNeo4jIntegers } from "../../../common/helpers/unwrap-neo4j-integer";
import { AgentScopeFilterService } from "../../../common/repositories/agent-scope.filter";
import { AI_SOURCE_QUERY, AiSourceQueryProvider } from "../../../common/repositories/ai-source-query.provider";
import { DataLimits } from "../../../common/types/data.limits";
import { EmbedderAttribution, EmbedderService } from "../../../core";
import { ModelService } from "../../../core/llm/services/model.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { Chunk, ChunkDescriptor } from "../../chunk/entities/chunk.entity";
import { chunkMeta } from "../entities/chunk.meta";
import { CHUNK_VECTOR_OVERFETCH, EXACT_SCAN_MAX_SCOPED_CHUNKS } from "./retrieval.constants";
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
    private readonly agentScope: AgentScopeFilterService,
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
   *
   * Each returned chunk carries `score`: the cosine similarity of that chunk against
   * the question embedding. Both retrieval halves have to reach the notebook on ONE
   * scale — the answer node orders entries best-score-first and fills a character
   * budget, so an unscored half sorts last however good it is. The RRF score is NOT
   * usable for that: it is rank-derived (the top hit scores ≈1/61 whether it is a
   * perfect match or noise) and is not comparable with a cosine from the graph half.
   */
  async findPotentialChunks(params: {
    question: string;
    dataLimits: DataLimits;
    attribution?: EmbedderAttribution;
    /**
     * Precomputed question embedding. When supplied the repository does NOT
     * embed again — the same question is otherwise embedded twice per turn,
     * once here and once in findPotentialKeyConcepts. Optional so existing
     * callers are unaffected.
     */
    queryEmbedding?: number[];
  }): Promise<Array<Chunk & { score?: number }>> {
    // The question is embedded ONCE per turn. When the caller already has the
    // vector (chunk_vector computes it and shares it through the graph state),
    // do not pay for a second identical embedding.
    const queryEmbedding =
      params.queryEmbedding ??
      (await this.embedderService.vectoriseText({
        text: params.question,
        attribution: params.attribution,
      }));

    // Lucene special-character escape so user questions can't break the fulltext query.
    //
    // NOT `buildFulltextTerm`: that helper tokenises and AND-joins a
    // contains-wildcard per token, which is right for a search BOX (a few
    // words) and wrong for a natural-language question. A 28-token question
    // becomes 28 AND-ed clauses that no chunk can satisfy — measured against
    // the eval corpus, the identical question went from 1,786 fulltext hits to
    // 0, silently collapsing hybrid retrieval to its vector branch alone.
    const term = params.question.replace(/([+\-!(){}\[\]^"~*?:\\\/]|&&|\|\|)/g, "\\$1");

    const scope = this.aiSourceQuery.build({
      dataLimits: params.dataLimits,
      currentUserId: this.clsService.get("userId"),
      securityService: this.securityService,
      returnsData: true,
    });
    const scopeFilter = this.agentScope.build({ alias: "data", dataLimits: params.dataLimits });

    // How large is the scoped set? One cheap count decides which shape to use.
    // Scope-first exact cosine has no recall cliff but reads every in-scope
    // embedding; the index is cheaper at volume but can only post-filter a
    // GLOBAL top-K, which is the cliff this task exists to remove.
    const countQuery = this.neo4j.initQuery();
    countQuery.queryParams = { ...countQuery.queryParams, ...scope.params, ...scopeFilter.params };
    countQuery.query += `
      ${scope.cypher}
      ${scopeFilter.cypher}
      MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(data)
      RETURN count(DISTINCT chunk) AS scopedCount
    `;
    const countResult = await this.neo4j.read(countQuery.query, countQuery.queryParams);
    const scopedCount = Number(countResult.records[0]?.get("scopedCount") ?? 0);
    if (scopedCount === 0) return [];

    const vectorIds =
      scopedCount <= EXACT_SCAN_MAX_SCOPED_CHUNKS
        ? await this.vectorIdsByExactScan({ scope, scopeFilter, queryEmbedding })
        : await this.vectorIdsByIndex({ scope, scopeFilter, queryEmbedding });

    const lexicalIds = term.trim() ? await this.lexicalIdsInScope({ scope, scopeFilter, term }) : [];

    const fusedIds = reciprocalRankFusion([vectorIds, lexicalIds]).slice(0, 20);
    return this.findChunksByIdsOrdered({ ids: fusedIds, queryEmbedding });
  }

  /**
   * Exact cosine over the scoped set. No recall cliff by construction: every
   * in-scope chunk is scored, so a small tenant can never be crowded out of a
   * global top-K by a large one.
   */
  private async vectorIdsByExactScan(params: {
    scope: { cypher: string; params?: Record<string, unknown> };
    scopeFilter: { cypher: string; params?: Record<string, unknown> };
    queryEmbedding: number[];
  }): Promise<string[]> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      ...params.scope.params,
      ...params.scopeFilter.params,
      queryEmbedding: params.queryEmbedding,
    };
    query.query += `
      ${params.scope.cypher}
      ${params.scopeFilter.cypher}
      MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(data)
      WHERE chunk.embedding IS NOT NULL
      WITH DISTINCT chunk
      WITH chunk, vector.similarity.cosine(chunk.embedding, $queryEmbedding) AS score
      WHERE score IS NOT NULL
      RETURN chunk.id AS id
      ORDER BY score DESC
      LIMIT 50
    `;
    const result = await this.neo4j.read(query.query, query.queryParams);
    return result.records.map((record: { get: (key: string) => unknown }) => record.get("id") as string);
  }

  /**
   * Index-backed fallback for scoped sets too large to scan exactly. Still
   * post-filters, so it still has a cliff — the over-fetch is what pushes that
   * cliff out of reach, and it is deliberately far above the previous 1,000.
   */
  private async vectorIdsByIndex(params: {
    scope: { cypher: string; params?: Record<string, unknown> };
    scopeFilter: { cypher: string; params?: Record<string, unknown> };
    queryEmbedding: number[];
  }): Promise<string[]> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      ...params.scope.params,
      ...params.scopeFilter.params,
      queryEmbedding: params.queryEmbedding,
      overFetch: CHUNK_VECTOR_OVERFETCH,
    };
    query.query += `
      ${params.scope.cypher}
      ${params.scopeFilter.cypher}
      MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(data)
      WITH collect(DISTINCT chunk.id) AS scopedChunkIds
      CALL db.index.vector.queryNodes('chunks', toInteger($overFetch), $queryEmbedding)
      YIELD node AS candidateChunk, score
      WITH scopedChunkIds, candidateChunk, score
      WHERE candidateChunk.id IN scopedChunkIds
      RETURN candidateChunk.id AS id
      ORDER BY score DESC
      LIMIT 50
    `;
    const result = await this.neo4j.read(query.query, query.queryParams);
    return result.records.map((record: { get: (key: string) => unknown }) => record.get("id") as string);
  }

  /**
   * Lexical branch, scoped the same way. Previously filtered against the
   * client-side id list; now joined in the database like the vector branch.
   */
  private async lexicalIdsInScope(params: {
    scope: { cypher: string; params?: Record<string, unknown> };
    scopeFilter: { cypher: string; params?: Record<string, unknown> };
    term: string;
  }): Promise<string[]> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      ...params.scope.params,
      ...params.scopeFilter.params,
      term: params.term,
    };
    query.query += `
      ${params.scope.cypher}
      ${params.scopeFilter.cypher}
      MATCH (chunk:Chunk)<-[:HAS_CHUNK]-(data)
      WITH collect(DISTINCT chunk.id) AS scopedChunkIds
      CALL db.index.fulltext.queryNodes('chunk_content_search', $term)
      YIELD node, score
      WITH scopedChunkIds, node, score
      WHERE node.id IN scopedChunkIds
      RETURN node.id AS id
      ORDER BY score DESC
      LIMIT 50
    `;
    const result = await this.neo4j.read(query.query, query.queryParams);
    return result.records.map((record: { get: (key: string) => unknown }) => record.get("id") as string);
  }

  /**
   * INPUT ORDER IS PART OF THE CONTRACT here too: `WHERE chunk.id IN $ids` yields rows
   * in store order, and the fused RRF order is what the caller means by "best first".
   *
   * `queryEmbedding` attaches the cosine score of each chunk against the question, on
   * the same scale `findChunksByIds` puts on the graph half. No floor and no count cap
   * are applied — the notebook's character budget decides what reaches the answer.
   */
  private async findChunksByIdsOrdered(params: {
    ids: string[];
    queryEmbedding?: number[];
  }): Promise<Array<Chunk & { score?: number }>> {
    if (params.ids.length === 0) return [];

    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });
    query.queryParams = {
      ...query.queryParams,
      ids: params.ids,
    };

    query.query += `
      MATCH (chunk:Chunk)
      WHERE chunk.id IN $ids
      RETURN chunk
    `;

    const chunks = await this.neo4j.readMany(query);
    const scored = await this.attachCosineScores({ chunks, queryEmbedding: params.queryEmbedding });
    const byId = new Map(scored.map((chunk) => [chunk.id, chunk]));
    return params.ids
      .map((id) => byId.get(id))
      .filter((chunk): chunk is Chunk & { score?: number } => chunk !== undefined);
  }

  /**
   * Attaches `vector.similarity.cosine(chunk.embedding, $queryEmbedding)` to already
   * hydrated chunks, by id, in JS.
   *
   * Why a separate read rather than one extra column on the hydration query: the
   * hydration goes through `readMany`, which maps every row with the descriptor's
   * generated mapper, and that mapper only ever reads the descriptor's own fields,
   * computed fields and virtual fields (`define-entity.ts`). A projected column such
   * as `score` is therefore silently DROPPED before the caller ever sees it. Reading
   * the id/score pairs on their own and merging them here keeps entity mapping on
   * `readMany` — this repository never hand-maps raw Neo4j records.
   *
   * SCOPE: this read scores only ids that the caller's own scope-gated query already
   * returned, so it cannot widen the scope by construction.
   */
  private async attachCosineScores<T extends Chunk>(params: {
    chunks: T[];
    queryEmbedding?: number[];
  }): Promise<Array<T & { score?: number }>> {
    if (!params.queryEmbedding || params.chunks.length === 0) return params.chunks;

    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      ids: params.chunks.map((chunk) => chunk.id),
      queryEmbedding: params.queryEmbedding,
    };
    query.query += `
      MATCH (chunk:Chunk)
      WHERE chunk.id IN $ids AND chunk.embedding IS NOT NULL
      RETURN chunk.id AS id, vector.similarity.cosine(chunk.embedding, $queryEmbedding) AS score
    `;

    const result = await this.neo4j.read(query.query, query.queryParams);
    const scoreById = new Map<string, number>();
    for (const record of result.records as Array<{ get: (key: string) => unknown }>) {
      const id = record.get("id");
      const score = record.get("score");
      if (typeof id === "string" && typeof score === "number") scoreById.set(id, score);
    }

    return params.chunks.map((chunk) => ({ ...chunk, score: scoreById.get(chunk.id) }));
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

  /**
   * `dataLimits` is optional so existing callers keep working, but the
   * contextualiser MUST pass it: the ids reaching this method come from an LLM
   * choosing among the chunks it was shown. That is a soft constraint — the
   * model can echo an id it saw in an earlier hop, or hallucinate one outright
   * — so the scope root is re-checked here rather than trusted from upstream.
   */
  async findChunkById(params: { chunkId: string; dataLimits?: DataLimits }): Promise<Chunk> {
    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });

    const scopePredicate = this.agentScope.predicate({ alias: "data", dataLimits: params.dataLimits });

    query.queryParams = {
      ...query.queryParams,
      chunkId: params.chunkId,
      ...(scopePredicate?.params ?? {}),
    };

    query.query += `
      MATCH (chunk:Chunk {id: $chunkId})
      ${scopePredicate ? `WHERE EXISTS { MATCH (chunk)<-[:HAS_CHUNK]-(data) WHERE ${scopePredicate.cypher} }` : ""}
      RETURN chunk
    `;

    return this.neo4j.readOne(query);
  }

  /**
   * Hydrates many chunks in ONE query, with the same scope gate `findChunkById`
   * applies to one. The caller previously looped with an `await` inside,
   * costing one round trip per queued chunk. Returns only the chunks that
   * exist and are in scope; the caller must not assume a 1:1 mapping with
   * `chunkIds`.
   *
   * ORDER IS PART OF THE CONTRACT. `WHERE chunk.id IN $chunkIds` returns rows in
   * whatever order the store yields them, but the loop this replaced hydrated in
   * queue order, and that order reaches the contextualiser's per-chunk fan-out and
   * the notebook entries it writes. Returning them shuffled changes what the answer
   * node cites. The input order is therefore restored here, exactly as
   * `findChunksByIdsOrdered` does for the retrieval path.
   *
   * `queryEmbedding` is OPTIONAL and, when given, attaches `score`: the cosine
   * similarity of the chunk against the question. These chunks arrive from a fact
   * join with no score of their own, which is precisely why an LLM used to have to
   * judge them; cosine puts this half on the SAME scale as the document half, so the
   * answer node can order both together. When it is absent the scoring clause is not
   * in the Cypher at all. No floor is applied at any point: the notebook's character
   * budget, not a threshold, decides what reaches the answer.
   */
  async findChunksByIds(params: {
    chunkIds: string[];
    dataLimits?: DataLimits;
    queryEmbedding?: number[];
  }): Promise<Array<Chunk & { score?: number }>> {
    if (params.chunkIds.length === 0) return [];

    const query = this.neo4j.initQuery({ serialiser: ChunkDescriptor.model });
    const scopePredicate = this.agentScope.predicate({ alias: "data", dataLimits: params.dataLimits });

    query.queryParams = {
      ...query.queryParams,
      chunkIds: params.chunkIds,
      ...(scopePredicate?.params ?? {}),
    };

    query.query += `
      MATCH (chunk:Chunk)
      WHERE chunk.id IN $chunkIds
      ${scopePredicate ? `AND EXISTS { MATCH (chunk)<-[:HAS_CHUNK]-(data) WHERE ${scopePredicate.cypher} }` : ""}
      RETURN chunk
    `;

    const chunks = await this.neo4j.readMany(query);
    const scored = await this.attachCosineScores({ chunks, queryEmbedding: params.queryEmbedding });
    const byId = new Map(scored.map((chunk) => [chunk.id, chunk]));
    return params.chunkIds
      .map((id) => byId.get(id))
      .filter((chunk): chunk is Chunk & { score?: number } => chunk !== undefined);
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
    query.queryParams = { ...query.queryParams, chunkIds: params.chunkIds };

    // Neo4j will not take a parameter as a variable-length bound, so the window
    // is clamped to a small integer and interpolated. It is never user input —
    // the only caller passes the NEIGHBOR_WINDOW constant — and Number() plus
    // the clamp make injection impossible.
    const window = Math.max(1, Math.min(5, Math.trunc(Number(params.window) || 1)));

    query.query = `
      UNWIND $chunkIds AS cid
      MATCH (c:Chunk {id: cid})
      OPTIONAL MATCH pBefore = (b:Chunk)-[:NEXT*1..${window}]->(c)
      WITH cid, c, b, length(pBefore) AS beforeDist ORDER BY beforeDist ASC
      WITH cid, c, [x IN collect(b) WHERE x IS NOT NULL][0..${window}] AS befores
      OPTIONAL MATCH pAfter = (c)-[:NEXT*1..${window}]->(a:Chunk)
      WITH cid, befores, a, length(pAfter) AS afterDist ORDER BY afterDist ASC
      WITH cid, befores, [x IN collect(a) WHERE x IS NOT NULL][0..${window}] AS afters
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
