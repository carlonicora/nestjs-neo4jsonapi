import { Injectable, Logger } from "@nestjs/common";
import { EmbedderService } from "../../../core/llm/services/embedder.service";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { buildEmbedderAttribution } from "../../common/usage-attribution";
import { CatalogEntity } from "../interfaces/graph.catalog.interface";
import { GraphIndexManager } from "./graph.index.manager";
import { GraphCatalogService } from "./graph.catalog.service";
import { ScopeGuard } from "./scope.guard";
import { escapeLuceneTerm } from "../../../core/neo4j/helpers/build-fulltext-term";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import {
  ExternalEntitySource,
  isExternalEntitySource,
} from "../../../common/interfaces/external.entity.source.interface";

export const GRAPH_EXACT_MAX_RESULTS = 10;
export const GRAPH_FUZZY_MAX_RESULTS = 10;
export const GRAPH_SEMANTIC_MAX_RESULTS = 5;
export const GRAPH_RESOLVE_MAX_RESULTS = 10;
export const GRAPH_SEMANTIC_MIN_SCORE = 0.6;
const GRAPH_VECTOR_OVERFETCH = 50;

export type MatchMode = "exact" | "fuzzy" | "semantic" | "none";

export interface RunSearchParams {
  entity: CatalogEntity;
  text: string;
  companyId: string;
  limit: number;
  /** Id of the scope-root node the run is confined to. Absent = unscoped. */
  scopeId?: string;
  /** JSON:API type of the scope root, e.g. "campaigns". Present iff scopeId is. */
  scopeType?: string;
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
  /** Id of the scope-root node the run is confined to. Absent = unscoped. */
  scopeId?: string;
  /** JSON:API type of the scope root, e.g. "campaigns". Present iff scopeId is. */
  scopeType?: string;
}

export interface ResolveEntityResult {
  matchMode: MatchMode;
  items: RankedCandidate[];
  /**
   * When the merged candidate list satisfies a deterministic disambiguation
   * rule (literal-summary match, or score-margin dominance), surface a short
   * actionable hint here. The graph node prompt instructs the LLM to follow
   * this when present, since LLMs apply rules in the tool result more
   * reliably than rules they have to re-derive from the system prompt.
   */
  recommendation?: string;
}

/**
 * Decide whether the merged candidate list satisfies a deterministic
 * disambiguation rule worth surfacing to the LLM. Returns the recommendation
 * text or `undefined` when the candidates are genuinely ambiguous.
 *
 * Two rules, in priority order:
 *   1. Literal-summary match: items[0].summary equals the user's literal
 *      phrase (case-insensitive). Holds even with a smaller margin because
 *      the name match is unambiguous on its own.
 *   2. Score-margin dominance: items[0] beats items[1] by ≥ 0.15 on
 *      exact/fuzzy tiers, ≥ 0.08 on semantic.
 */
export function buildResolveRecommendation(
  items: RankedCandidate[],
  userText: string,
  matchMode: MatchMode,
): string | undefined {
  if (items.length === 0) return undefined;
  const top = items[0];
  const next = items[1];
  const margin = next ? top.score - next.score : Number.POSITIVE_INFINITY;
  const literalMatch = top.summary.trim().toLowerCase() === userText.trim().toLowerCase();
  const dominantMargin = margin >= (matchMode === "semantic" ? 0.08 : 0.15);

  if (literalMatch && (items.length === 1 || dominantMargin)) {
    return `Use items[0] (id=${top.id}, type=${top.type}): its summary equals the user's literal phrase and dominates by score margin. Do not ask the user to disambiguate.`;
  }
  if (dominantMargin) {
    return `Use items[0] (id=${top.id}, type=${top.type}): it dominates the next candidate by the documented score margin (${margin.toFixed(2)}).`;
  }
  return undefined;
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
    // ScopeGuard is deliberately the LAST constructor parameter so existing
    // positional call sites keep working. It is only consulted for a scoped
    // run (scopeId + scopeType present).
    private readonly scopeGuard: ScopeGuard,
    /**
     * Supplies each type's service for two things: an `ExternalEntitySource`
     * name lookup, and the record-level access check every app-database
     * candidate must pass (`findRecordById`). Optional in the TYPE signature
     * only, after ScopeGuard for the same positional reason; Nest resolves it
     * (CoreModule exports it globally). Without it no external type is
     * searched and every app-database candidate is dropped (fail closed).
     */
    private readonly registry?: EntityServiceRegistry,
  ) {}

  /**
   * Scope predicate for a tier query, or null when the run is unscoped.
   * The clause NARROWS the existing company predicate; it never replaces it.
   */
  private scopeClauseFor(params: RunSearchParams): { cypher: string; params: Record<string, unknown> } | null {
    if (!params.scopeId || !params.scopeType) return null;
    return this.scopeGuard.buildMatchClause({
      entity: params.entity,
      ctx: {
        companyId: params.companyId,
        userId: "",
        userModuleIds: [],
        scopeId: params.scopeId,
        scopeType: params.scopeType,
      },
      nodeAlias: "node",
    });
  }

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
    const visible = this.catalog.getAllChatEnabledEntities().filter((e) => params.userModuleIds.includes(e.moduleId));

    // Fail closed: in a scoped run, a type that cannot be chained to the run's
    // scope root is unreachable, so it never fans out a tier query at all.
    // Leaving it in would surface candidates from other scope roots.
    // A `scopeShared` type is reference data, visible in every scoped run.
    const entities =
      params.scopeId && params.scopeType
        ? visible.filter((e) => e.scope?.rootType === params.scopeType || e.scopeShared)
        : visible;

    if (!entities.length) {
      return { matchMode: "none", items: [] };
    }

    const tiers: Array<["substring" | "fuzzy" | "semantic", MatchMode]> = [
      ["substring", "exact"],
      ["fuzzy", "fuzzy"],
      ["semantic", "semantic"],
    ];

    // A type whose records live outside the app database supplies its own name
    // lookup. It replaces that type's app-DB tiers and runs with the first tier.
    const externalByType = new Map<string, ExternalEntitySource>();
    for (const entity of entities) {
      const service = this.registry?.get(entity.type);
      if (isExternalEntitySource(service)) externalByType.set(entity.type, service);
    }
    const entityByType = new Map(entities.map((entity) => [entity.type, entity]));

    for (const [tier, label] of tiers) {
      const buckets = await Promise.all(
        entities.map((e) => {
          const external = externalByType.get(e.type);
          if (!external) return this.runTierForEntitySafe(e, params, tier);
          return tier === "substring" ? this.runExternalForEntitySafe(e, external, params) : Promise.resolve([]);
        }),
      );
      const merged: RankedCandidate[] = buckets.flat();
      if (!merged.length) continue;
      merged.sort((a, b) => b.score - a.score);
      const items = await this.keepAccessible({ candidates: merged, params, externalByType, entityByType });
      if (items.length) {
        const recommendation = buildResolveRecommendation(items, params.text, label);
        return recommendation ? { matchMode: label, items, recommendation } : { matchMode: label, items };
      }
    }

    return { matchMode: "none", items: [] };
  }

  /**
   * Walks the score-ordered candidates and keeps those the user may see, until
   * GRAPH_RESOLVE_MAX_RESULTS are kept:
   *  - an app-database candidate is kept only when its type's service reads it
   *    back (`findRecordById`), so the repository's record-level access rules
   *    apply to the name lookup exactly as they apply to read_entity. A type
   *    with no registered service is dropped;
   *  - an external candidate is global reference data: no record-level check;
   *  - in a scoped run, a candidate with no Cypher scope clause (an external
   *    candidate, or any `viaService` type) is kept only when `ScopeGuard.filter`
   *    keeps it.
   * Candidates are checked in windows, in parallel within a window, so order is
   * preserved without one sequential read per candidate.
   */
  private async keepAccessible(params: {
    candidates: RankedCandidate[];
    params: ResolveEntityParams;
    externalByType: Map<string, ExternalEntitySource>;
    entityByType: Map<string, CatalogEntity>;
  }): Promise<RankedCandidate[]> {
    const kept: RankedCandidate[] = [];
    let cursor = 0;
    while (kept.length < GRAPH_RESOLVE_MAX_RESULTS && cursor < params.candidates.length) {
      const window = params.candidates.slice(cursor, cursor + (GRAPH_RESOLVE_MAX_RESULTS - kept.length));
      cursor += window.length;
      const verdicts = await Promise.all(
        window.map((candidate) =>
          this.isCandidateVisible({
            candidate,
            params: params.params,
            external: params.externalByType.has(candidate.type),
            entity: params.entityByType.get(candidate.type),
          }),
        ),
      );
      window.forEach((candidate, index) => {
        if (verdicts[index] && kept.length < GRAPH_RESOLVE_MAX_RESULTS) kept.push(candidate);
      });
    }
    return kept;
  }

  private async isCandidateVisible(params: {
    candidate: RankedCandidate;
    params: ResolveEntityParams;
    external: boolean;
    entity: CatalogEntity | undefined;
  }): Promise<boolean> {
    const { candidate } = params;
    try {
      if (!params.external) {
        const service = this.registry?.get(candidate.type);
        if (!service) return false;
        const record = await service.findRecordById({ id: candidate.id });
        if (!record) return false;
      }

      const scoped = !!params.params.scopeId && !!params.params.scopeType;
      const needsScopeFilter = params.external || !!params.entity?.scope?.viaService;
      if (!scoped || !needsScopeFilter) return true;
      if (!this.scopeGuard) return false;
      const inScope = await this.scopeGuard.filter({
        type: candidate.type,
        records: [{ id: candidate.id }],
        ctx: {
          companyId: params.params.companyId,
          userId: "",
          userModuleIds: params.params.userModuleIds,
          scopeId: params.params.scopeId,
          scopeType: params.params.scopeType,
        },
      });
      return inScope.length === 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`resolveEntity: access check type=${candidate.type} id=${candidate.id} threw: ${message}`);
      return false;
    }
  }

  /** `ExternalEntitySource.resolveByText` for one type; errors drop the type, never the lookup. */
  private async runExternalForEntitySafe(
    entity: CatalogEntity,
    source: ExternalEntitySource,
    params: ResolveEntityParams,
  ): Promise<RankedCandidate[]> {
    try {
      const candidates = await source.resolveByText({ text: params.text, limit: GRAPH_EXACT_MAX_RESULTS });
      this.logger.debug(`resolve_entity external type=${entity.type} items=${candidates.length}`);
      return candidates.map((candidate) => ({
        type: entity.type,
        id: candidate.id,
        summary: candidate.name || candidate.id,
        score: candidate.score,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`resolveEntity: external type=${entity.type} threw: ${message}`);
      return [];
    }
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
        scopeId: params.scopeId,
        scopeType: params.scopeType,
      };
      const inner = tier === "semantic" ? await this.tierSemantic(runParams) : await this.tierFulltext(runParams, tier);

      // Per-tier diagnostic so a future dump can distinguish "fulltext index
      // missing" from "lucene parse failure" from "genuine zero hits". Today
      // these were silently merged into a single matchMode=none response.
      const indexName =
        tier === "semantic"
          ? this.indexNames.vectorIndexName(entity.labelName)
          : this.indexNames.fulltextIndexName(entity.labelName);
      const existing = await this.getExistingIndexes();
      const indexExists = existing.size === 0 || existing.has(indexName);
      this.logger.debug(
        `resolve_entity tier=${tier} type=${entity.type} indexExists=${indexExists} items=${inner.items.length}`,
      );

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
    const escaped = escapeLuceneTerm(params.text).toLowerCase();
    const term = mode === "substring" ? `*${escaped}*` : `${escaped}~`;
    const max = mode === "substring" ? GRAPH_EXACT_MAX_RESULTS : GRAPH_FUZZY_MAX_RESULTS;

    // Scope narrows the company predicate — it is appended to it, never a
    // replacement. Every value stays parameterised.
    const scopeClause = this.scopeClauseFor(params);

    const result = await this.neo4j.read(
      `
      CALL db.index.fulltext.queryNodes($indexName, $term)
      YIELD node, score
      WHERE (node)-[:BELONGS_TO]->(:Company { id: $companyId })
        ${scopeClause?.cypher ?? ""}
      RETURN node.id AS id, properties(node) AS properties, score
      ORDER BY score DESC
      LIMIT toInteger($limit)
      `,
      {
        indexName,
        term,
        companyId: params.companyId,
        limit: Math.min(params.limit, max),
        ...(scopeClause?.params ?? {}),
      },
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
    // Query-time embedding: billed to the run's SCOPE ROOT, which `runSearch`
    // already carries. `scopeType` is a JSON:API type ("campaigns") and the
    // `USED_FOR` edge is matched on the label ("Campaign"), so it goes through
    // the registry. An unscoped run has no honest entity to name, and
    // `persistUsage` then records nothing.
    const queryEmbedding = await this.embedder.vectoriseText({
      text: params.text,
      attribution: buildEmbedderAttribution({ entityId: params.scopeId, entityIdentifier: params.scopeType }),
    });

    // Scope narrows the company predicate — it is appended to it, never a
    // replacement. Every value stays parameterised.
    const scopeClause = this.scopeClauseFor(params);

    const result = await this.neo4j.read(
      `
      CALL db.index.vector.queryNodes($indexName, toInteger($overFetch), $queryEmbedding)
      YIELD node, score
      WHERE (node)-[:BELONGS_TO]->(:Company { id: $companyId })
        AND score >= $minScore
        ${scopeClause?.cypher ?? ""}
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
        ...(scopeClause?.params ?? {}),
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
