import { vi, describe, it, expect, beforeEach } from "vitest";
import { GraphSearchService, buildResolveRecommendation, RankedCandidate } from "../graph.search.service";

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
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog);

    const out = await svc.resolveEntity({ text: "anything", companyId: "co1", userModuleIds: [] });

    expect(out).toEqual({ matchMode: "none", items: [] });
    expect(neo4j.read).not.toHaveBeenCalled();
  });

  it("returns matchMode='none' when no chat-enabled entities are accessible", async () => {
    catalog.getAllChatEnabledEntities.mockReturnValue([]);
    const neo4j = { read: vi.fn() };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog);

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
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog);

    const out = await svc.resolveEntity({
      text: "Faby and Carlo",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(out.matchMode).toBe("exact");
    expect(out.items).toEqual([{ type: "accounts", id: "a1", summary: "Faby and Carlo", score: 9.2 }]);
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
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog);

    const out = await svc.resolveEntity({
      text: "Carlo",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(out.matchMode).toBe("exact");
    expect(out.items.map((i) => i.id)).toEqual(["p1", "a1"]);
    expect(out.items[0]).toEqual({ type: "persons", id: "p1", summary: "Carlo Nicora", score: 8.8 });
    expect(out.items[1]).toEqual({ type: "accounts", id: "a1", summary: "Carlo Inc", score: 7.5 });
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
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog);

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
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog);

    const out = await svc.resolveEntity({
      text: "the German guys",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(out.matchMode).toBe("semantic");
    expect(out.items).toEqual([{ type: "accounts", id: "a3", summary: "ACME", score: 0.82 }]);
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
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog);

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
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog);

    const out = await svc.resolveEntity({
      text: "x",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(out.matchMode).toBe("exact");
    expect(out.items).toEqual([{ type: "persons", id: "p1", summary: "A B", score: 2.0 }]);
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
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog);

    const out = await svc.resolveEntity({
      text: "w",
      companyId: "co1",
      userModuleIds: ["11111111-1111-1111-1111-111111111111"],
    });
    expect(out.items[0].summary).toBe("Widget-A");
    expect(out.items[1].summary).toBe("w2");
  });

  it("filters entities by userModuleIds (never queries types outside user's modules)", async () => {
    const neo4j = { read: vi.fn() };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new GraphSearchService(neo4j as any, embedder as any, indexNames as any, catalog);

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
    const out = buildResolveRecommendation(items([["Faby and Carlo", 2.29], ["Carlo MBP", 1.0]]), "Faby and Carlo", "exact");
    expect(out).toMatch(/items\[0\]/);
    expect(out).toMatch(/literal phrase/);
    expect(out).toMatch(/Do not ask the user/);
  });

  it("recommends items[0] on a literal-summary match when there is no second candidate", () => {
    const out = buildResolveRecommendation(items([["Acme Corp", 1.0]]), "acme corp", "exact");
    expect(out).toMatch(/literal phrase/);
  });

  it("recommends items[0] on score-margin dominance even without a literal-summary match", () => {
    const out = buildResolveRecommendation(items([["Acme Holdings", 2.0], ["Other Co", 1.0]]), "acme", "fuzzy");
    expect(out).toMatch(/dominates the next candidate/);
    expect(out).toMatch(/1\.00/); // margin formatted
  });

  it("returns undefined when neither rule fires (ambiguous candidates)", () => {
    const out = buildResolveRecommendation(items([["Carlo MBP", 1.0], ["Carlo Nicora", 1.0]]), "Carlo", "exact");
    expect(out).toBeUndefined();
  });

  it("uses the looser semantic margin (0.08) when matchMode is semantic", () => {
    // Margin = 0.10 — below 0.15 (exact/fuzzy threshold) but above 0.08 (semantic threshold).
    const tight = items([["X", 1.0], ["Y", 0.9]]);
    expect(buildResolveRecommendation(tight, "anything", "fuzzy")).toBeUndefined();
    expect(buildResolveRecommendation(tight, "anything", "semantic")).toMatch(/dominates/);
  });

  it("returns undefined for an empty list", () => {
    expect(buildResolveRecommendation([], "x", "exact")).toBeUndefined();
  });

  it("is case-insensitive when comparing literal summaries to the user phrase", () => {
    const out = buildResolveRecommendation(items([["FABY AND CARLO", 2.29], ["x", 1]]), "faby and carlo", "exact");
    expect(out).toMatch(/literal phrase/);
  });
});
