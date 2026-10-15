import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  GraphSearchService,
  GRAPH_RESOLVE_MAX_RESULTS,
  buildResolveRecommendation,
  buildResolveDisambiguation,
  RankedCandidate,
} from "../graph.search.service";
import { modelRegistry } from "../../../../common/registries/registry";

function makeEntity(type: string, labelName: string, moduleId: string, summary?: (d: any) => string) {
  return {
    type,
    moduleId,
    labelName,
    nodeName: labelName.toLowerCase(),
    textSearchFields: ["name"],
    summary,
    description: "x",
    fields: [],
    relationships: [],
  } as any;
}

/**
 * Every app-database candidate passes a record-level access check through its
 * type's service (hole 6). This registry lets every candidate through, so the
 * tests that are about ranking and tiers keep testing exactly that.
 */
const allowAll = {
  get: () => ({ findRecordById: async ({ id }: { id: string }) => ({ id }) }),
};

const indexNames = {
  fulltextIndexName: (label: string) => `${label.toLowerCase()}_chat_fulltext`,
  vectorIndexName: (label: string) => `${label.toLowerCase()}_chat_embedding`,
};

describe("GraphSearchService.resolveEntity", () => {
  const account = makeEntity("accounts", "Account", "11111111-1111-1111-1111-111111111111", (d) => d.name);
  const person = makeEntity(
    "persons",
    "Person",
    "11111111-1111-1111-1111-111111111111",
    (d) => `${d.firstName} ${d.lastName}`,
  );

  let catalog: any;
  beforeEach(() => {
    catalog = {
      getAllChatEnabledEntities: vi.fn(() => [account, person]),
    };
  });

  it("returns matchMode='none' when user has no accessible modules", async () => {
    const neo4j = { read: vi.fn() };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(
      neo4j as any,
      embedder as any,
      indexNames as any,
      catalog,
      undefined as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({ text: "anything", companyId: "co1", userModuleIds: [] });

    expect(out).toEqual({ matchMode: "none", items: [] });
    expect(neo4j.read).not.toHaveBeenCalled();
  });

  it("returns matchMode='none' when no chat-enabled entities are accessible", async () => {
    catalog.getAllChatEnabledEntities.mockReturnValue([]);
    const neo4j = { read: vi.fn() };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(
      neo4j as any,
      embedder as any,
      indexNames as any,
      catalog,
      undefined as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({
      text: "x",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });
    expect(out).toEqual({ matchMode: "none", items: [] });
  });

  it("returns exact-tier-only results even when lower tiers would also match", async () => {
    const neo4j: any = {
      read: vi.fn().mockImplementation(async (_cypher: string, params: any) => {
        if (params.indexName === "account_chat_fulltext" && String(params.term).startsWith("*")) {
          return {
            records: [
              {
                get: (k: string) => (({ id: "a1", properties: { name: "Faby and Carlo" }, score: 9.2 }) as any)[k],
              },
            ],
          };
        }
        return { records: [] };
      }),
    };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(
      neo4j as any,
      embedder as any,
      indexNames as any,
      catalog,
      undefined as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({
      text: "Faby and Carlo",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(out.matchMode).toBe("exact");
    // Scores are normalised per type: the type's best candidate scores 1.
    expect(out.items).toEqual([{ type: "accounts", id: "a1", summary: "Faby and Carlo", score: 1 }]);
    // 1 SHOW INDEXES (cached) + 2 substring tier queries (one per entity type) = 3.
    expect(neo4j.read).toHaveBeenCalledTimes(3);
    expect(embedder.vectoriseText).not.toHaveBeenCalled();
  });

  it("merges and sorts results from multiple types in the winning tier", async () => {
    const neo4j: any = {
      read: vi.fn().mockImplementation(async (_cypher: string, params: any) => {
        if (params.indexName === "account_chat_fulltext") {
          return {
            records: [
              { get: (k: string) => (({ id: "a1", properties: { name: "Carlo Inc" }, score: 7.5 }) as any)[k] },
            ],
          };
        }
        if (params.indexName === "person_chat_fulltext") {
          return {
            records: [
              {
                get: (k: string) =>
                  (({ id: "p1", properties: { firstName: "Carlo", lastName: "Nicora" }, score: 8.8 }) as any)[k],
              },
            ],
          };
        }
        return { records: [] };
      }),
    };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(
      neo4j as any,
      embedder as any,
      indexNames as any,
      catalog,
      undefined as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({
      text: "Carlo",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    // "Carlo" is a substring of both summaries, equal to neither.
    expect(out.matchMode).toBe("substring");
    // Each type's best candidate normalises to 1: raw Lucene scores across
    // types are not comparable, so the tie keeps catalog order.
    expect(out.items.map((i) => i.id)).toEqual(["a1", "p1"]);
    expect(out.items[0]).toEqual({ type: "accounts", id: "a1", summary: "Carlo Inc", score: 1 });
    expect(out.items[1]).toEqual({ type: "persons", id: "p1", summary: "Carlo Nicora", score: 1 });
  });

  it("falls through to fuzzy when no exact hits anywhere, and stops there", async () => {
    const neo4j: any = {
      read: vi.fn().mockImplementation(async (_c: string, params: any) => {
        const isFuzzy = typeof params.term === "string" && params.term.endsWith("~");
        if (isFuzzy && params.indexName === "person_chat_fulltext") {
          return {
            records: [
              {
                get: (k: string) =>
                  (({ id: "p2", properties: { firstName: "Fabiana", lastName: "Zonca" }, score: 3.1 }) as any)[k],
              },
            ],
          };
        }
        return { records: [] };
      }),
    };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(
      neo4j as any,
      embedder as any,
      indexNames as any,
      catalog,
      undefined as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({
      text: "Faby",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(out.matchMode).toBe("fuzzy");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("p2");
    expect(embedder.vectoriseText).not.toHaveBeenCalled();
  });

  it("falls through to semantic when both fulltext tiers return nothing", async () => {
    const neo4j: any = {
      read: vi.fn().mockImplementation(async (cypher: string, params: any) => {
        const isVector = cypher.includes("db.index.vector.queryNodes");
        if (isVector && params.indexName === "account_chat_embedding") {
          return {
            records: [{ get: (k: string) => (({ id: "a3", properties: { name: "ACME" }, score: 0.82 }) as any)[k] }],
          };
        }
        return { records: [] };
      }),
    };
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };
    const svc = new GraphSearchService(
      neo4j as any,
      embedder as any,
      indexNames as any,
      catalog,
      undefined as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({
      text: "the German guys",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(out.matchMode).toBe("semantic");
    expect(out.items).toEqual([{ type: "accounts", id: "a3", summary: "ACME", score: 1 }]);
    expect(embedder.vectoriseText).toHaveBeenCalled();
  });

  it("caps merged results at 10", async () => {
    const makeRecords = (prefix: string, startScore: number) =>
      Array.from({ length: 8 }, (_, i) => ({
        get: (k: string) =>
          (({ id: `${prefix}${i}`, properties: { name: `${prefix}-${i}` }, score: startScore - i }) as any)[k],
      }));
    const neo4j: any = {
      read: vi.fn().mockImplementation(async (_c: string, params: any) => {
        if (params.indexName === "account_chat_fulltext") return { records: makeRecords("a", 20) };
        if (params.indexName === "person_chat_fulltext") return { records: makeRecords("p", 19) };
        return { records: [] };
      }),
    };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(
      neo4j as any,
      embedder as any,
      indexNames as any,
      catalog,
      undefined as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({
      text: "x",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(out.items).toHaveLength(10);
    const scores = out.items.map((i) => i.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("isolates per-type errors: one type throws, others still contribute", async () => {
    const neo4j: any = {
      read: vi.fn().mockImplementation(async (_c: string, params: any) => {
        if (params.indexName === "account_chat_fulltext") throw new Error("index missing");
        if (params.indexName === "person_chat_fulltext") {
          return {
            records: [
              {
                get: (k: string) =>
                  (({ id: "p1", properties: { firstName: "A", lastName: "B" }, score: 2.0 }) as any)[k],
              },
            ],
          };
        }
        return { records: [] };
      }),
    };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(
      neo4j as any,
      embedder as any,
      indexNames as any,
      catalog,
      undefined as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({
      text: "x",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(out.matchMode).toBe("substring");
    expect(out.items).toEqual([{ type: "persons", id: "p1", summary: "A B", score: 1 }]);
  });

  it("falls back to name/id when an entity has no summary function", async () => {
    const entityWithoutSummary = makeEntity("widgets", "Widget", "11111111-1111-1111-1111-111111111111");
    catalog.getAllChatEnabledEntities.mockReturnValue([entityWithoutSummary]);
    const neo4j: any = {
      read: vi.fn().mockImplementation(async (_c: string, params: any) => {
        if (params.indexName === "widget_chat_fulltext") {
          return {
            records: [
              { get: (k: string) => (({ id: "w1", properties: { name: "Widget-A" }, score: 1.0 }) as any)[k] },
              { get: (k: string) => (({ id: "w2", properties: {}, score: 0.9 }) as any)[k] },
            ],
          };
        }
        return { records: [] };
      }),
    };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(
      neo4j as any,
      embedder as any,
      indexNames as any,
      catalog,
      undefined as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({
      text: "w",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });
    expect(out.items[0].summary).toBe("Widget-A");
    expect(out.items[1].summary).toBe("w2");
  });

  it("a scoped resolve keeps scopeShared types", async () => {
    const proceeding = makeEntity("proceedings", "Proceeding", "11111111-1111-1111-1111-111111111111", (d) => d.name);
    proceeding.scope = { rootType: "proceedings", rootLabel: "Proceeding", path: [] };
    const law = makeEntity("laws", "Law", "11111111-1111-1111-1111-111111111111", (d) => d.name);
    law.scopeShared = true;
    // Unchained and unshared: still dropped in a scoped run (fail closed).
    const article = makeEntity("articles", "Article", "11111111-1111-1111-1111-111111111111", (d) => d.name);
    catalog.getAllChatEnabledEntities.mockReturnValue([proceeding, law, article]);

    const queried: string[] = [];
    const neo4j: any = {
      read: vi.fn().mockImplementation(async (_cypher: string, params: any) => {
        if (params?.indexName) queried.push(params.indexName);
        if (params?.indexName === "law_chat_fulltext" && String(params.term).startsWith("*")) {
          return {
            records: [
              { get: (k: string) => (({ id: "l1", properties: { name: "Codice civile" }, score: 9 }) as any)[k] },
            ],
          };
        }
        return { records: [] };
      }),
    };
    const scopeGuard = {
      buildMatchClause: vi.fn(({ entity }: any) =>
        entity.scopeShared
          ? { cypher: "", params: {} }
          : { cypher: "AND EXISTS { MATCH (node:Proceeding { id: $scopeId }) }", params: { scopeId: "p-1" } },
      ),
    };
    const svc = new GraphSearchService(
      neo4j as any,
      { vectoriseText: vi.fn() } as any,
      indexNames as any,
      catalog,
      scopeGuard as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({
      text: "Codice civile",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
      scopeId: "p-1",
      scopeType: "proceedings",
    });

    expect(out.items).toEqual([{ type: "laws", id: "l1", summary: "Codice civile", score: 1 }]);
    expect(queried).toContain("law_chat_fulltext");
    expect(queried).toContain("proceeding_chat_fulltext");
    expect(queried).not.toContain("article_chat_fulltext");
  });

  it("filters entities by userModuleIds (never queries types outside user's modules)", async () => {
    const neo4j = { read: vi.fn() };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(
      neo4j as any,
      embedder as any,
      indexNames as any,
      catalog,
      undefined as any,
      allowAll as any,
    );

    const out = await svc.resolveEntity({
      text: "x",
      companyId: "co1",
      userModuleIds: ["22222222-2222-2222-2222-222222222222"],
    });

    expect(out).toEqual({ matchMode: "none", items: [] });
    expect(neo4j.read).not.toHaveBeenCalled();
  });
});

describe("buildResolveRecommendation", () => {
  const items = (rows: Array<[string, number]>): RankedCandidate[] =>
    rows.map(([summary, score], i) => ({ type: "accounts", id: `id-${i}`, summary, score }));

  it("recommends items[0] when its summary equals the user phrase and dominates by margin", () => {
    const out = buildResolveRecommendation(
      items([
        ["Faby and Carlo", 2.29],
        ["Carlo MBP", 1.0],
      ]),
      "Faby and Carlo",
      "exact",
    );
    expect(out).toMatch(/items\[0\]/);
    expect(out).toMatch(/literal phrase/);
    expect(out).toMatch(/Do not ask the user/);
  });

  it("recommends items[0] on a literal-summary match when there is no second candidate", () => {
    const out = buildResolveRecommendation(items([["Acme Corp", 1.0]]), "acme corp", "exact");
    expect(out).toMatch(/literal phrase/);
  });

  it("recommends items[0] on score-margin dominance even without a literal-summary match", () => {
    const out = buildResolveRecommendation(
      items([
        ["Acme Holdings", 2.0],
        ["Other Co", 1.0],
      ]),
      "acme",
      "fuzzy",
    );
    expect(out).toMatch(/dominates the next candidate/);
    expect(out).toMatch(/1\.00/); // margin formatted
  });

  it("returns undefined when neither rule fires (ambiguous candidates)", () => {
    const out = buildResolveRecommendation(
      items([
        ["Carlo MBP", 1.0],
        ["Carlo Nicora", 1.0],
      ]),
      "Carlo",
      "exact",
    );
    expect(out).toBeUndefined();
  });

  it("uses the looser semantic margin (0.08) when matchMode is semantic", () => {
    // Margin = 0.10 — below 0.15 (exact/fuzzy threshold) but above 0.08 (semantic threshold).
    const tight = items([
      ["X", 1.0],
      ["Y", 0.9],
    ]);
    expect(buildResolveRecommendation(tight, "anything", "fuzzy")).toBeUndefined();
    expect(buildResolveRecommendation(tight, "anything", "semantic")).toMatch(/dominates/);
  });

  it("returns undefined for an empty list", () => {
    expect(buildResolveRecommendation([], "x", "exact")).toBeUndefined();
  });

  it("is case-insensitive when comparing literal summaries to the user phrase", () => {
    const out = buildResolveRecommendation(
      items([
        ["FABY AND CARLO", 2.29],
        ["x", 1],
      ]),
      "faby and carlo",
      "exact",
    );
    expect(out).toMatch(/literal phrase/);
  });
  // Embedding cost attribution (Task 8). The semantic tier embeds the user's
  // text; that spend is billed to the run's SCOPE ROOT. `scopeType` is a
  // JSON:API type and a TokenUsage record's USED_FOR edge is matched on the
  // Neo4j LABEL, so it must be translated through the registry.
  describe("embedding cost attribution", () => {
    const semanticOnlyNeo4j = () => ({
      read: vi.fn().mockImplementation(async (cypher: string) => {
        if (cypher.includes("db.index.vector.queryNodes")) {
          return {
            records: [{ get: (k: string) => (({ id: "a3", properties: { name: "ACME" }, score: 0.82 }) as any)[k] }],
          };
        }
        return { records: [] };
      }),
    });

    it("bills the query embedding to the run's scope root, as a Neo4j label", async () => {
      modelRegistry.register({ nodeName: "campaign", labelName: "Campaign", type: "campaigns" } as never);
      const scoped = makeEntity("accounts", "Account", "11111111-1111-1111-1111-111111111111", (d: any) => d.name);
      scoped.scope = { rootType: "campaigns", path: [] };
      const scopedCatalog: any = { getAllChatEnabledEntities: vi.fn(() => [scoped]) };

      const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };
      const scopeGuard = {
        buildMatchClause: vi.fn(() => ({ cypher: "", params: {} })),
      };
      const svc = new GraphSearchService(
        semanticOnlyNeo4j() as any,
        embedder as any,
        indexNames as any,
        scopedCatalog,
        scopeGuard as any,
        allowAll as any,
      );

      await svc.resolveEntity({
        text: "the German guys",
        companyId: "co1",
        userModuleIds: ["11111111-1111-1111-1111-111111111111"],
        scopeId: "campaign-1",
        scopeType: "campaigns",
      });

      expect(embedder.vectoriseText).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: expect.objectContaining({ relationshipId: "campaign-1", relationshipType: "Campaign" }),
        }),
      );
    });

    it("records nothing for an unscoped run — there is no entity to bill", async () => {
      const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };
      const unscopedCatalog: any = {
        getAllChatEnabledEntities: vi.fn(() => [
          makeEntity("accounts", "Account", "11111111-1111-1111-1111-111111111111", (d: any) => d.name),
        ]),
      };
      const svc = new GraphSearchService(
        semanticOnlyNeo4j() as any,
        embedder as any,
        indexNames as any,
        unscopedCatalog,
        undefined as any,
        allowAll as any,
      );

      await svc.resolveEntity({
        text: "the German guys",
        companyId: "co1",
        userModuleIds: ["11111111-1111-1111-1111-111111111111"],
      });

      expect(embedder.vectoriseText).toHaveBeenCalledWith({ text: "the German guys", attribution: undefined });
    });
  });
});

/**
 * External sources (C1) and the record-level access check on the name lookup
 * (hole 6): a candidate is only returned when its type's service reads it back.
 */
describe("GraphSearchService.resolveEntity — external sources and access", () => {
  const MODULE = "11111111-1111-1111-1111-111111111111";
  const account = makeEntity("accounts", "Account", MODULE, (d) => d.name);
  const person = makeEntity("persons", "Person", MODULE, (d) => d.name);
  const law = makeEntity("laws", "Law", MODULE, (d) => d.name);
  law.scopeShared = true;

  const row = (id: string, name: string, score: number) => ({
    get: (k: string) => (({ id, properties: { name }, score }) as any)[k],
  });

  /** Neo4j mock: answers each fulltext substring query from `byIndex`, records every index queried. */
  const neo4jFor = (byIndex: Record<string, any[]>) => {
    const queried: string[] = [];
    const neo4j: any = {
      read: vi.fn().mockImplementation(async (_cypher: string, params: any) => {
        if (params?.indexName) queried.push(params.indexName);
        if (params?.indexName && String(params.term).startsWith("*")) {
          return { records: byIndex[params.indexName] ?? [] };
        }
        return { records: [] };
      }),
    };
    return { neo4j, queried };
  };

  const build = (entities: any[], neo4j: any, registry: any, scopeGuard?: any) =>
    new GraphSearchService(
      neo4j,
      { vectoriseText: vi.fn().mockResolvedValue([0.1]) } as any,
      indexNames as any,
      { getAllChatEnabledEntities: vi.fn(() => entities) } as any,
      (scopeGuard ?? undefined) as any,
      registry,
    );

  it("uses resolveByText for an external source type and never runs its tier Cypher", async () => {
    const lawService = {
      resolveByText: vi.fn(async () => [{ id: "l1", name: "Codice civile", score: 5 }]),
      findRecordById: vi.fn(),
    };
    const registry = {
      get: vi.fn((type: string) => (type === "laws" ? lawService : { findRecordById: async () => ({}) })),
    };
    const { neo4j, queried } = neo4jFor({});
    const svc = build([account, law], neo4j, registry);

    const out = await svc.resolveEntity({ text: "Codice civile", companyId: "co1", userModuleIds: [MODULE] });

    expect(lawService.resolveByText).toHaveBeenCalledTimes(1);
    expect(lawService.resolveByText).toHaveBeenCalledWith({ text: "Codice civile", limit: 10 });
    expect(out.matchMode).toBe("exact");
    expect(out.items).toEqual([{ type: "laws", id: "l1", summary: "Codice civile", score: 1 }]);
    expect(queried).toContain("account_chat_fulltext");
    expect(queried.some((name) => name.startsWith("law_"))).toBe(false);
  });

  it("drops a DB candidate whose service findRecordById returns null", async () => {
    const accountService = {
      findRecordById: vi.fn(async ({ id }: { id: string }) => (id === "a1" ? null : { id })),
    };
    const registry = { get: vi.fn(() => accountService) };
    const { neo4j } = neo4jFor({ account_chat_fulltext: [row("a1", "Hidden pratica", 9), row("a2", "Visible", 8)] });
    const svc = build([account], neo4j, registry);

    const out = await svc.resolveEntity({ text: "pratica", companyId: "co1", userModuleIds: [MODULE] });

    expect(accountService.findRecordById).toHaveBeenCalledWith({ id: "a1" });
    expect(out.items.map((i) => i.id)).toEqual(["a2"]);
  });

  it("drops a DB candidate whose type has no registered service", async () => {
    const registry = {
      get: vi.fn((type: string) => (type === "accounts" ? { findRecordById: async () => ({}) } : undefined)),
    };
    const { neo4j } = neo4jFor({
      account_chat_fulltext: [row("a1", "Acme", 5)],
      person_chat_fulltext: [row("p1", "Acme person", 9)],
    });
    const svc = build([account, person], neo4j, registry);

    const out = await svc.resolveEntity({ text: "Acme", companyId: "co1", userModuleIds: [MODULE] });

    expect(out.items.map((i) => i.id)).toEqual(["a1"]);
  });

  it("keeps scanning past dropped candidates until GRAPH_RESOLVE_MAX_RESULTS are kept", async () => {
    const accountRows = Array.from({ length: 10 }, (_, i) => row(`a${i}`, `Account ${i}`, 100 - i));
    const personRows = Array.from({ length: 10 }, (_, i) => row(`p${i}`, `Person ${i}`, 50 - i));
    // The five best-scored candidates are denied.
    const denied = new Set(["a0", "a1", "a2", "a3", "a4"]);
    const registry = {
      get: vi.fn(() => ({ findRecordById: async ({ id }: { id: string }) => (denied.has(id) ? null : { id }) })),
    };
    const { neo4j } = neo4jFor({ account_chat_fulltext: accountRows, person_chat_fulltext: personRows });
    const svc = build([account, person], neo4j, registry);

    const out = await svc.resolveEntity({ text: "x", companyId: "co1", userModuleIds: [MODULE] });

    expect(out.items).toHaveLength(GRAPH_RESOLVE_MAX_RESULTS);
    // Normalised per type: accounts are score/100 (a5 = 0.95), persons are
    // score/50 (p0 = 1, p1 = 0.98), so the two types interleave.
    expect(out.items.map((i) => i.id)).toEqual(["p0", "p1", "p2", "a5", "a6", "p3", "a7", "a8", "p4", "a9"]);
  });

  it("a scoped run passes external candidates through ScopeGuard.filter", async () => {
    const massima = makeEntity("massime", "Massima", MODULE, (d) => d.name);
    massima.scope = { rootType: "proceedings", rootLabel: "Proceeding", path: [], viaService: true };
    const massimaService = {
      resolveByText: vi.fn(async () => [
        { id: "m1", name: "In scope", score: 3 },
        { id: "m2", name: "Out of scope", score: 4 },
      ]),
      findRecordById: vi.fn(),
    };
    const registry = { get: vi.fn((type: string) => (type === "massime" ? massimaService : undefined)) };
    const scopeGuard = {
      buildMatchClause: vi.fn(() => null),
      filter: vi.fn(async ({ records }: { records: Array<{ id: string }> }) => records.filter((r) => r.id === "m1")),
    };
    const { neo4j } = neo4jFor({});
    const svc = build([massima], neo4j, registry, scopeGuard);

    const out = await svc.resolveEntity({
      text: "danno",
      companyId: "co1",
      userModuleIds: [MODULE],
      scopeId: "p-1",
      scopeType: "proceedings",
    });

    expect(scopeGuard.filter).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "massime",
        records: [{ id: "m2" }],
        ctx: expect.objectContaining({ scopeId: "p-1", scopeType: "proceedings" }),
      }),
    );
    expect(out.items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("external candidates skip the findRecordById access check", async () => {
    const lawService = {
      resolveByText: vi.fn(async () => [
        { id: "l1", name: "Codice civile", score: 5 },
        { id: "l2", name: "Codice penale", score: 4 },
      ]),
      findRecordById: vi.fn(async () => null),
    };
    const registry = { get: vi.fn(() => lawService) };
    const { neo4j } = neo4jFor({});
    const svc = build([law], neo4j, registry);

    const out = await svc.resolveEntity({ text: "Codice", companyId: "co1", userModuleIds: [MODULE] });

    expect(out.items.map((i) => i.id)).toEqual(["l1", "l2"]);
    expect(lawService.findRecordById).not.toHaveBeenCalled();
  });
});

/**
 * Ranking, labels and ties (spec R3/F3): Lucene scores and external rank
 * scores are normalised per type before merging; the substring tier reports
 * "substring" unless the top summary equals the text; a summary tie never
 * yields a recommendation.
 */
describe("GraphSearchService.resolveEntity — ranking, labels and ties", () => {
  const MODULE = "11111111-1111-1111-1111-111111111111";
  const email = makeEntity("emails", "Email", MODULE, (d) => d.name);
  const judgement = makeEntity("judgements", "Judgement", MODULE, (d) => d.name);

  const row = (id: string, name: string, score: number) => ({
    get: (k: string) => (({ id, properties: { name }, score }) as any)[k],
  });

  const build = (
    rows: Record<string, any[]>,
    judgements: Array<{ id: string; name: string; score: number; exact?: boolean; key?: string }>,
  ) => {
    const neo4j: any = {
      read: vi.fn().mockImplementation(async (_cypher: string, params: any) => {
        if (params?.indexName && String(params.term).startsWith("*")) return { records: rows[params.indexName] ?? [] };
        return { records: [] };
      }),
    };
    const judgementService = { resolveByText: vi.fn(async () => judgements), findRecordById: vi.fn() };
    const registry = {
      get: vi.fn((type: string) =>
        type === "judgements" ? judgementService : { findRecordById: async ({ id }: { id: string }) => ({ id }) },
      ),
    };
    return new GraphSearchService(
      neo4j,
      { vectoriseText: vi.fn() } as any,
      indexNames as any,
      { getAllChatEnabledEntities: vi.fn(() => [email, judgement]) } as any,
      undefined as any,
      registry as any,
    );
  };

  it("normalises scores per type before merging", async () => {
    const svc = build(
      { email_chat_fulltext: [row("e1", "Mail about 14345", 12.5), row("e2", "Other mail 14345", 6.6)] },
      [
        { id: "j1", name: "14345/2024", score: 1.0 },
        { id: "j2", name: "14345/2023", score: 0.67 },
      ],
    );

    const out = await svc.resolveEntity({ text: "14345", companyId: "co1", userModuleIds: [MODULE] });

    const ids = out.items.map((i) => i.id);
    const top = out.items[0];
    const j1 = out.items.find((i) => i.id === "j1")!;
    expect(j1.score).toBeCloseTo(top.score);
    expect(ids.indexOf("j2")).toBeLessThan(ids.indexOf("e2"));
    expect(out.items.find((i) => i.id === "e2")!.score).toBeCloseTo(6.6 / 12.5);
  });

  it("labels the substring tier substring and the literal match exact", async () => {
    const literal = build({ email_chat_fulltext: [row("e1", "Faby and Carlo", 5)] }, []);
    const literalOut = await literal.resolveEntity({
      text: "faby and carlo",
      companyId: "co1",
      userModuleIds: [MODULE],
    });
    expect(literalOut.matchMode).toBe("exact");

    const partial = build({ email_chat_fulltext: [row("e1", "Faby and Carlo", 5)] }, []);
    const partialOut = await partial.resolveEntity({ text: "Faby", companyId: "co1", userModuleIds: [MODULE] });
    expect(partialOut.matchMode).toBe("substring");
  });

  it("withholds the recommendation on a summary tie", async () => {
    const svc = build({}, [
      { id: "j-civ", name: "14345/2024", score: 1.0 },
      { id: "j-pen", name: "14345/2024", score: 1.0 },
    ]);

    const out = await svc.resolveEntity({ text: "14345/2024", companyId: "co1", userModuleIds: [MODULE] });

    expect(out.matchMode).toBe("exact");
    expect(out.recommendation).toBeUndefined();
    expect(out.disambiguation).toMatch(/court/);
    expect(out.disambiguation).toMatch(/sezione/);
    expect(out.disambiguation).toContain("14345/2024");
  });

  it("recommends on a literal match with no tie", async () => {
    const svc = build({}, [
      { id: "j1", name: "14345/2024", score: 1.0 },
      { id: "j2", name: "14345/2023", score: 0.5 },
    ]);

    const out = await svc.resolveEntity({ text: "14345/2024", companyId: "co1", userModuleIds: [MODULE] });

    expect(out.matchMode).toBe("exact");
    expect(out.recommendation).toMatch(/literal phrase/);
    expect(out.disambiguation).toBeUndefined();
  });

  it("ties two external candidates sharing a key even when their labels differ", async () => {
    const svc = build({}, [
      {
        id: "j-pen",
        name: "14345/2024 — Cass. pen. Sez. 5, sent. 08/04/2024",
        score: 1.0,
        exact: true,
        key: "14345/2024",
      },
      {
        id: "j-civ",
        name: "14345/2024 — Cass. civ. Sez. 3, ord. 22/05/2024",
        score: 1.0,
        exact: true,
        key: "14345/2024",
      },
    ]);

    const out = await svc.resolveEntity({ text: "14345/2024", companyId: "co1", userModuleIds: [MODULE] });

    expect(out.matchMode).toBe("exact");
    expect(out.recommendation).toBeUndefined();
    expect(out.disambiguation).toMatch(/court/);
    expect(out.disambiguation).toMatch(/sezione/);
    expect(out.disambiguation).toContain("14345/2024");
    expect(out.items.map((i) => i.key)).toEqual(["14345/2024", "14345/2024"]);
  });

  it("reports exact and recommends a single exact external hit with a labelled summary", async () => {
    const svc = build({}, [
      {
        id: "j-pen",
        name: "14345/2024 — Cass. pen. Sez. 5, sent. 08/04/2024",
        score: 1.0,
        exact: true,
        key: "14345/2024",
      },
    ]);

    const out = await svc.resolveEntity({ text: "14345/2024", companyId: "co1", userModuleIds: [MODULE] });

    expect(out.matchMode).toBe("exact");
    expect(out.items[0]).toMatchObject({ id: "j-pen", exact: true, key: "14345/2024" });
    expect(out.recommendation).toMatch(/id=j-pen/);
    expect(out.disambiguation).toBeUndefined();
  });

  it("keeps the substring label for a non-exact external hit whose label differs from the text", async () => {
    const svc = build({}, [{ id: "j1", name: "14345/2024 — Cass. pen. Sez. 5", score: 0.4 }]);

    const out = await svc.resolveEntity({ text: "omicidio stradale", companyId: "co1", userModuleIds: [MODULE] });

    expect(out.matchMode).toBe("substring");
  });
});

describe("buildResolveDisambiguation", () => {
  const rows = (summaries: string[]): RankedCandidate[] =>
    summaries.map((summary, i) => ({ type: "judgements", id: `id-${i}`, summary, score: 1 }));

  it("returns undefined when no other candidate shares the top summary", () => {
    expect(buildResolveDisambiguation(rows(["A", "B"]))).toBeUndefined();
    expect(buildResolveDisambiguation([])).toBeUndefined();
  });

  it("detects a case-insensitive tie anywhere in the list", () => {
    expect(buildResolveDisambiguation(rows(["Acme", "Other", "ACME"]))).toMatch(/share the summary "Acme"/);
  });

  it("ties on key when present, not on the labelled summary", () => {
    const keyed: RankedCandidate[] = [
      { type: "judgements", id: "a", summary: "1/2024 — Cass. pen.", key: "1/2024", score: 1 },
      { type: "judgements", id: "b", summary: "1/2024 — Cass. civ.", key: "1/2024", score: 1 },
    ];
    expect(buildResolveDisambiguation(keyed)).toContain('"1/2024"');
    expect(buildResolveRecommendation(keyed, "1/2024", "exact")).toBeUndefined();
  });
});

describe("buildResolveRecommendation — summary ties", () => {
  it("never recommends when another candidate has the same summary", () => {
    const tied: RankedCandidate[] = [
      { type: "judgements", id: "a", summary: "14345/2024", score: 1 },
      { type: "judgements", id: "b", summary: "14345/2024", score: 0.5 },
    ];
    expect(buildResolveRecommendation(tied, "14345/2024", "exact")).toBeUndefined();
  });
});
