import { Injectable, Logger } from "@nestjs/common";
import { EmbedderService } from "../../../core/llm/services/embedder.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { CatalogEntity } from "../interfaces/graph.catalog.interface";
import { GraphIndexManager } from "./graph.index.manager";
import { GraphCatalogService } from "./graph.catalog.service";

export const GRAPH_EXACT_MAX_RESULTS = 10;
export const GRAPH_FUZZY_MAX_RESULTS = 10;
export const GRAPH_SEMANTIC_MAX_RESULTS = 5;
export const GRAPH_RESOLVE_MAX_RESULTS = 10;
export const GRAPH_SEMANTIC_MIN_SCORE = 0.6;
const GRAPH_VECTOR_OVERFETCH = 50;

const LUCENE_RESERVED_RE = /[+\-&|!(){}[\]^"~*?:\\/]/g;

export type MatchMode = "exact" | "fuzzy" | "semantic" | "none";

export interface RunSearchParams {
  entity: CatalogEntity;
  text: string;
  companyId: string;
  limit: number;
}

export interface RankedCandidate {
  type: string;
  id: string;
  summary: string;
  score: number;
}

export interface ResolveEntityParams {
  text: string;
  companyId: string;
  userModuleIds: string[];
}

export interface ResolveEntityResult {
  matchMode: MatchMode;
  items: RankedCandidate[];
}

/** Internal shape returned by tier primitives; has everything resolveEntity needs. */
interface InternalTierItem {
  id: string;
  score: number;
  properties: Record<string, unknown>;
}

@Injectable()
export class GraphSearchService {
  private readonly logger = new Logger(GraphSearchService.name);

  // Cached at first use, holds the names of fulltext + vector indexes that
  // actually exist in Neo4j. Pre-checking this set lets us skip the
  // `db.index.fulltext.queryNodes` call entirely for indexes the bootstrap
  // didn't create (silencing the ERROR + WARN spam at source). Stored as a
  // promise to deduplicate concurrent first-time lookups (resolveEntity fans
  // out tier queries via Promise.all).
  private existingIndexesPromise: Promise<Set<string>> | null = null;

  constructor(
    private readonly neo4j: Neo4jService,
    private readonly embedder: EmbedderService,
    private readonly indexNames: GraphIndexManager,
    private readonly catalog: GraphCatalogService,
  ) {}

  private getExistingIndexes(): Promise<Set<string>> {
    if (this.existingIndexesPromise) return this.existingIndexesPromise;
    this.existingIndexesPromise = (async () => {
      try {
        const result = await this.neo4j.read(
          `SHOW INDEXES YIELD name, type WHERE type IN ["FULLTEXT", "VECTOR"] RETURN name`,
        );
        return new Set<string>(((result as any).records ?? []).map((r: any) => r.get("name")));
      } catch {
        // If SHOW INDEXES itself fails (older Neo4j, permissions, mocked tests
        // that don't expect it), return an empty set. Downstream gating uses
        // `size > 0 && !has(name)` so an empty set means "do not gate" — the
        // tier query proceeds and any error is handled by runTierForEntitySafe.
        return new Set<string>();
      }
    })();
    return this.existingIndexesPromise;
  }

  async resolveEntity(params: ResolveEntityParams): Promise<ResolveEntityResult> {
    const entities = this.catalog.getAllChatEnabledEntities().filter((e) => params.userModuleIds.includes(e.moduleId));

    if (!entities.length) {
      return { matchMode: "none", items: [] };
    }

    const tiers: Array<["substring" | "fuzzy" | "semantic", MatchMode]> = [
      ["substring", "exact"],
      ["fuzzy", "fuzzy"],
      ["semantic", "semantic"],
    ];

    for (const [tier, label] of tiers) {
      const buckets = await Promise.all(entities.map((e) => this.runTierForEntitySafe(e, params, tier)));
      const merged: RankedCandidate[] = buckets.flat();
      if (merged.length) {
        merged.sort((a, b) => b.score - a.score);
        return { matchMode: label, items: merged.slice(0, GRAPH_RESOLVE_MAX_RESULTS) };
      }
    }

    return { matchMode: "none", items: [] };
  }

  private async runTierForEntitySafe(
    entity: CatalogEntity,
    params: ResolveEntityParams,
    tier: "substring" | "fuzzy" | "semantic",
  ): Promise<RankedCandidate[]> {
    try {
      const runParams: RunSearchParams = {
        entity,
        text: params.text,
        companyId: params.companyId,
        limit:
          tier === "semantic"
            ? GRAPH_SEMANTIC_MAX_RESULTS
            : tier === "fuzzy"
              ? GRAPH_FUZZY_MAX_RESULTS
              : GRAPH_EXACT_MAX_RESULTS,
      };
      const inner = tier === "semantic" ? await this.tierSemantic(runParams) : await this.tierFulltext(runParams, tier);
      return inner.items.map((i) => ({
        type: entity.type,
        id: i.id,
        summary: this.projectSummary(entity, i.properties, i.id),
        score: i.score,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Missing fulltext / vector index for an entity type the manager bootstrap
      // didn't create one for: silently skip this tier for this type. The whole
      // Neo4j stack trace was being printed at ERROR level for every resolve_entity
      // call — pure noise. Real failures (other Neo4j errors, network, etc.) still
      // log at WARN as before.
      if (/There is no such fulltext schema index|There is no such vector schema index/i.test(message)) {
        return [];
      }
      this.logger.warn(`resolveEntity: tier=${tier} type=${entity.type} threw: ${message}`);
      return [];
    }
  }

  private projectSummary(
    entity: { summary?: (d: any) => string },
    properties: Record<string, unknown>,
    id: string,
  ): string {
    if (entity.summary) {
      try {
        return entity.summary(properties);
      } catch {
        /* fall through */
      }
    }
    const name = (properties as any).name;
    if (typeof name === "string" && name.length) return name;
    return id;
  }

  private async tierFulltext(
    params: RunSearchParams,
    mode: "substring" | "fuzzy",
  ): Promise<{ matchMode: MatchMode; items: InternalTierItem[] }> {
    const indexName = this.indexNames.fulltextIndexName(params.entity.labelName);
    const existing = await this.getExistingIndexes();
    if (existing.size > 0 && !existing.has(indexName)) {
      return { matchMode: mode === "substring" ? "exact" : "fuzzy", items: [] };
    }
    const escaped = params.text.replace(LUCENE_RESERVED_RE, "\\$&").toLowerCase();
    const term = mode === "substring" ? `*${escaped}*` : `${escaped}~`;
    const max = mode === "substring" ? GRAPH_EXACT_MAX_RESULTS : GRAPH_FUZZY_MAX_RESULTS;

    const result = await this.neo4j.read(
      `
      CALL db.index.fulltext.queryNodes($indexName, $term)
      YIELD node, score
      WHERE (node)-[:BELONGS_TO]->(:Company { id: $companyId })
      RETURN node.id AS id, properties(node) AS properties, score
      ORDER BY score DESC
      LIMIT toInteger($limit)
      `,
      { indexName, term, companyId: params.companyId, limit: Math.min(params.limit, max) },
    );

    const items: InternalTierItem[] = (result as any).records.map((r: any) => ({
      id: r.get("id"),
      score: r.get("score"),
      properties: r.get("properties") ?? {},
    }));
    return { matchMode: mode === "substring" ? "exact" : "fuzzy", items };
  }

  private async tierSemantic(params: RunSearchParams): Promise<{ matchMode: MatchMode; items: InternalTierItem[] }> {
    const indexName = this.indexNames.vectorIndexName(params.entity.labelName);
    const existing = await this.getExistingIndexes();
    if (existing.size > 0 && !existing.has(indexName)) {
      return { matchMode: "semantic", items: [] };
    }
    const queryEmbedding = await this.embedder.vectoriseText({ text: params.text });

    const result = await this.neo4j.read(
      `
      CALL db.index.vector.queryNodes($indexName, toInteger($overFetch), $queryEmbedding)
      YIELD node, score
      WHERE (node)-[:BELONGS_TO]->(:Company { id: $companyId })
        AND score >= $minScore
      RETURN node.id AS id, properties(node) AS properties, score
      ORDER BY score DESC
      LIMIT toInteger($limit)
      `,
      {
        indexName,
        overFetch: GRAPH_VECTOR_OVERFETCH,
        queryEmbedding,
        companyId: params.companyId,
        minScore: GRAPH_SEMANTIC_MIN_SCORE,
        limit: Math.min(params.limit, GRAPH_SEMANTIC_MAX_RESULTS),
      },
    );

    const items: InternalTierItem[] = (result as any).records.map((r: any) => ({
      id: r.get("id"),
      score: r.get("score"),
      properties: r.get("properties") ?? {},
    }));

    return { matchMode: items.length ? "semantic" : "none", items };
  }
}
