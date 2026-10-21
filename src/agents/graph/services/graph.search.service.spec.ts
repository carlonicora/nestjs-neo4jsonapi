import { vi, describe, it, expect } from "vitest";
import { GRAPH_EXACT_SCAN_MAX_SCOPED_NODES, GraphSearchService } from "./graph.search.service";
import type { ScopeGuard } from "./scope.guard";

const countRecords = (scopedCount: number) => ({
  records: [{ get: (key: string) => (key === "scopedCount" ? scopedCount : undefined) }],
});

const entityAccount = {
  type: "accounts",
  moduleId: "11111111-1111-1111-1111-111111111111",
  labelName: "Account",
  nodeName: "account",
  textSearchFields: ["name"],
  summary: (d: any) => d.name,
  description: "x",
  fields: [],
  relationships: [],
} as any;

const indexNames = {
  fulltextIndexName: (label: string) => `${label.toLowerCase()}_chat_fulltext`,
  vectorIndexName: (label: string) => `${label.toLowerCase()}_chat_embedding`,
};

const catalog: any = { getAllChatEnabledEntities: vi.fn(() => [entityAccount]) };

// Every run below is unscoped, so the guard is never consulted.
const unscopedGuard = { buildMatchClause: vi.fn(), filter: vi.fn() } as unknown as ScopeGuard;

describe("GraphSearchService — tier Cypher projection", () => {
  // First read() is always SHOW INDEXES (cached lookup of existing fulltext/vector
  // indexes — see GraphSearchService.getExistingIndexes). Tier queries follow.
  // Test helpers below pull tier calls from index 1+ to skip past it.
  const tierCalls = (mock: any) => mock.mock.calls.slice(1);

  it("tier 1 substring Cypher projects properties(node) alongside id and score", async () => {
    const neo4j = { read: vi.fn().mockResolvedValue({ records: [] }) };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog, unscopedGuard);
    await svc.resolveEntity({ text: "x", companyId: "co1", userModuleIds: ["11111111-1111-1111-1111-111111111111"] });

    const cypher = tierCalls(neo4j.read)[0][0] as string;
    expect(cypher).toMatch(/properties\(node\)\s+AS\s+properties/);
    expect(cypher).toMatch(/node\.id\s+AS\s+id/);
    expect(cypher).toMatch(/\(node\)-\[:BELONGS_TO\]->\(:Company \{ id: \$companyId \}\)/);
  });

  it("tier 3 semantic Cypher projects properties(node) alongside id and score", async () => {
    const neo4j = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ records: [] }) // SHOW INDEXES
        .mockResolvedValueOnce({ records: [] }) // tier 1
        .mockResolvedValueOnce({ records: [] }) // tier 2
        .mockResolvedValueOnce(countRecords(10)) // tier 3 count
        .mockResolvedValueOnce({ records: [] }), // tier 3 ranking
    };
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog, unscopedGuard);
    await svc.resolveEntity({ text: "x", companyId: "co1", userModuleIds: ["11111111-1111-1111-1111-111111111111"] });

    const cypher = tierCalls(neo4j.read)[3][0] as string;
    expect(cypher).toMatch(/properties\(node\)\s+AS\s+properties/);
    expect(cypher).toMatch(/\(node\)-\[:BELONGS_TO\]->\(:Company \{ id: \$companyId \}\)/);
  });

  // Semantic tier: SHOW INDEXES, tier 1, tier 2, then the count and the ranking query.
  const semanticNeo4j = (scopedCount: number) => ({
    read: vi.fn().mockImplementation(async (cypher: string) => {
      if (cypher.includes("AS scopedCount")) return countRecords(scopedCount);
      return { records: [] };
    }),
  });
  const semanticCalls = (mock: any): string[] =>
    (mock.mock.calls as any[][])
      .map((c) => c[0] as string)
      .filter((c) => c.includes("AS scopedCount") || c.includes("vector."));

  it("ranks semantic candidates by exact cosine over the company's nodes when the scoped set is small", async () => {
    const neo4j = semanticNeo4j(10);
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog, unscopedGuard);
    await svc.resolveEntity({ text: "x", companyId: "co1", userModuleIds: ["11111111-1111-1111-1111-111111111111"] });

    const [countCypher, scanCypher] = semanticCalls(neo4j.read);
    expect(countCypher).toContain("(node)-[:BELONGS_TO]->(:Company { id: $companyId })");
    expect(scanCypher).toContain("vector.similarity.cosine(node.name_embedding, $queryEmbedding)");
    const companyAt = scanCypher.indexOf("(node)-[:BELONGS_TO]->(:Company { id: $companyId })");
    const cosineAt = scanCypher.indexOf("vector.similarity.cosine(node.name_embedding, $queryEmbedding)");
    expect(companyAt).toBeGreaterThanOrEqual(0);
    expect(companyAt).toBeLessThan(cosineAt);
    expect(scanCypher).not.toContain("db.index.vector.queryNodes");
  });

  it("falls back to the vector index over-fetch above GRAPH_EXACT_SCAN_MAX_SCOPED_NODES", async () => {
    const neo4j = semanticNeo4j(GRAPH_EXACT_SCAN_MAX_SCOPED_NODES + 1);
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog, unscopedGuard);
    await svc.resolveEntity({ text: "x", companyId: "co1", userModuleIds: ["11111111-1111-1111-1111-111111111111"] });

    const [, rankCypher] = semanticCalls(neo4j.read);
    expect(rankCypher).toContain("db.index.vector.queryNodes($indexName");
    expect(rankCypher).not.toContain("vector.similarity.cosine");
  });

  it("returns no semantic items and skips ranking when the company has no embedded nodes", async () => {
    const neo4j = semanticNeo4j(0);
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog, unscopedGuard);
    const out = await svc.resolveEntity({
      text: "x",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(semanticCalls(neo4j.read)).toHaveLength(1);
    expect(out.items).toEqual([]);
  });

  it("keeps the scope clause inside the exact-scan query", async () => {
    const scopeCypher = "AND EXISTS { MATCH (node)-[:PART_OF]->(:Campaign { id: $scopeId }) }";
    const scopeGuard = {
      buildMatchClause: vi.fn(() => ({ cypher: scopeCypher, params: { scopeId: "campaign-1" } })),
      filter: vi.fn(async (p: any) => p.records),
    } as unknown as ScopeGuard;
    const scopedEntity = { ...entityAccount, scope: { rootType: "campaigns", path: [] } };
    const scopedCatalog: any = { getAllChatEnabledEntities: vi.fn(() => [scopedEntity]) };
    const neo4j = semanticNeo4j(10);
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, scopedCatalog, scopeGuard);
    await svc.resolveEntity({
      text: "x",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
      scopeId: "campaign-1",
      scopeType: "campaigns",
    });

    expect(scopeGuard.buildMatchClause).toHaveBeenCalledWith(expect.objectContaining({ nodeAlias: "node" }));
    const [countCypher, scanCypher] = semanticCalls(neo4j.read);
    expect(countCypher).toContain(scopeCypher);
    expect(scanCypher).toContain(scopeCypher);
    expect(scanCypher).toContain("vector.similarity.cosine(node.name_embedding, $queryEmbedding)");
    const scanParams = (neo4j.read.mock.calls as any[][]).find((c) => c[0] === scanCypher)![1];
    expect(scanParams.scopeId).toBe("campaign-1");
  });

  it("tier 1 escapes Lucene reserved characters in the search term", async () => {
    const neo4j = { read: vi.fn().mockResolvedValue({ records: [] }) };
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };

    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog, unscopedGuard);
    await svc.resolveEntity({
      text: "Faby & Carlo",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    const tier1Params = tierCalls(neo4j.read)[0][1];
    expect(tier1Params.term).not.toMatch(/[^\\]&/);
    expect(tier1Params.term).toContain("\\&");
  });
});
