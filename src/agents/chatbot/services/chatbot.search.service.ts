import { Injectable } from "@nestjs/common";
import { EmbedderService } from "../../../core/llm/services/embedder.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { CatalogEntity } from "../interfaces/graph.catalog.interface";
import { ChatbotIndexManager } from "./chatbot.index.manager";

export const CHATBOT_EXACT_MAX_RESULTS = 10;
export const CHATBOT_FUZZY_MAX_RESULTS = 10;
export const CHATBOT_SEMANTIC_MAX_RESULTS = 5;
export const CHATBOT_SEMANTIC_MIN_SCORE = 0.6;
const CHATBOT_VECTOR_OVERFETCH = 50;

const LUCENE_RESERVED_RE = /[+\-&|!(){}[\]^"~*?:\\/]/g;

export type MatchMode = "exact" | "fuzzy" | "semantic" | "none";

export interface SearchItem {
  id: string;
  score: number | null;
}

export interface SearchResult {
  matchMode: MatchMode;
  items: SearchItem[];
}

export interface RunSearchParams {
  entity: CatalogEntity;
  text: string;
  companyId: string;
  limit: number;
}

/** Internal shape returned by tier primitives; has everything resolveEntity needs. */
interface InternalTierItem {
  id: string;
  score: number;
  properties: Record<string, unknown>;
}

@Injectable()
export class ChatbotSearchService {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly embedder: EmbedderService,
    private readonly indexNames: ChatbotIndexManager,
  ) {}

  async runCascadingSearch(params: RunSearchParams): Promise<SearchResult> {
    const exact = await this.tierFulltext(params, "substring");
    if (exact.items.length) return this.toPublic(exact);

    const fuzzy = await this.tierFulltext(params, "fuzzy");
    if (fuzzy.items.length) return this.toPublic(fuzzy);

    const semantic = await this.tierSemantic(params);
    return this.toPublic(semantic);
  }

  private toPublic(inner: { matchMode: MatchMode; items: InternalTierItem[] }): SearchResult {
    return {
      matchMode: inner.matchMode,
      items: inner.items.map((i) => ({ id: i.id, score: i.score })),
    };
  }

  private async tierFulltext(
    params: RunSearchParams,
    mode: "substring" | "fuzzy",
  ): Promise<{ matchMode: MatchMode; items: InternalTierItem[] }> {
    const indexName = this.indexNames.fulltextIndexName(params.entity.labelName);
    const escaped = params.text.replace(LUCENE_RESERVED_RE, "\\$&").toLowerCase();
    const term = mode === "substring" ? `*${escaped}*` : `${escaped}~`;
    const max = mode === "substring" ? CHATBOT_EXACT_MAX_RESULTS : CHATBOT_FUZZY_MAX_RESULTS;

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

  private async tierSemantic(
    params: RunSearchParams,
  ): Promise<{ matchMode: MatchMode; items: InternalTierItem[] }> {
    const indexName = this.indexNames.vectorIndexName(params.entity.labelName);
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
        overFetch: CHATBOT_VECTOR_OVERFETCH,
        queryEmbedding,
        companyId: params.companyId,
        minScore: CHATBOT_SEMANTIC_MIN_SCORE,
        limit: Math.min(params.limit, CHATBOT_SEMANTIC_MAX_RESULTS),
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
