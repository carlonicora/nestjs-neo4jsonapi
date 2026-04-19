import { ChatbotSearchService } from "./chatbot.search.service";

const entity = {
  labelName: "Account",
  nodeName: "account",
  textSearchFields: ["name"],
} as any;

const indexNames = {
  fulltextIndexName: (label: string) => `${label.toLowerCase()}_chat_fulltext`,
  vectorIndexName: (label: string) => `${label.toLowerCase()}_chat_embedding`,
};

describe("ChatbotSearchService — tier 1 substring", () => {
  it("returns matchMode='exact' with items when fulltext substring matches", async () => {
    const neo4j = {
      read: vi.fn().mockResolvedValue({
        records: [{ get: (k: string) => (({ id: "a1", score: 12.3 }) as any)[k] }],
      }),
    };
    const embedder = { vectoriseText: vi.fn() };

    const svc = new ChatbotSearchService(neo4j as any, embedder as any, indexNames as any);
    const out = await svc.runCascadingSearch({
      entity,
      text: "Faby",
      companyId: "co1",
      limit: 10,
    });

    expect(out.matchMode).toBe("exact");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("a1");
    expect(out.items[0].score).toBeCloseTo(12.3);
    expect(neo4j.read).toHaveBeenCalledTimes(1);
    expect(embedder.vectoriseText).not.toHaveBeenCalled();
  });

  it("escapes Lucene reserved characters in the search term", async () => {
    const neo4j = { read: vi.fn().mockResolvedValue({ records: [] }) };
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };

    const svc = new ChatbotSearchService(neo4j as any, embedder as any, indexNames as any);
    await svc.runCascadingSearch({ entity, text: "Faby & Carlo", companyId: "co1", limit: 10 });

    // tier 1 call's term should have escaped the ampersand
    const firstCall = neo4j.read.mock.calls[0];
    const params = firstCall[1];
    expect(params.term).not.toMatch(/[^\\]&/);
    expect(params.term).toContain("\\&");
  });
});

describe("ChatbotSearchService — tier 2 fuzzy", () => {
  it("falls back to fuzzy when substring returns nothing, returns matchMode='fuzzy'", async () => {
    const neo4j = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ records: [] }) // tier 1 empty
        .mockResolvedValueOnce({ records: [{ get: (k: string) => (({ id: "a2", score: 4.4 }) as any)[k] }] }), // tier 2 hits
    };
    const embedder = { vectoriseText: vi.fn() };

    const svc = new ChatbotSearchService(neo4j as any, embedder as any, indexNames as any);
    const out = await svc.runCascadingSearch({ entity, text: "Fabby", companyId: "co1", limit: 10 });

    expect(out.matchMode).toBe("fuzzy");
    expect(out.items[0].id).toBe("a2");
    expect(neo4j.read).toHaveBeenCalledTimes(2);
    expect(embedder.vectoriseText).not.toHaveBeenCalled();

    const tier2Params = neo4j.read.mock.calls[1][1];
    expect(tier2Params.term).toMatch(/~$/);
  });
});

describe("ChatbotSearchService — tier 3 semantic", () => {
  it("falls back to vector search when both fulltext tiers are empty", async () => {
    const neo4j = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({
          records: [
            { get: (k: string) => (({ id: "a3", score: 0.82 }) as any)[k] },
            { get: (k: string) => (({ id: "a4", score: 0.71 }) as any)[k] },
          ],
        }),
    };
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1, 0.2]) };

    const svc = new ChatbotSearchService(neo4j as any, embedder as any, indexNames as any);
    const out = await svc.runCascadingSearch({
      entity,
      text: "the German guys we ship pumps to",
      companyId: "co1",
      limit: 5,
    });

    expect(out.matchMode).toBe("semantic");
    expect(out.items.map((i) => i.id)).toEqual(["a3", "a4"]);
    expect(embedder.vectoriseText).toHaveBeenCalledWith({ text: "the German guys we ship pumps to" });

    const semanticArgs = neo4j.read.mock.calls[2];
    expect(semanticArgs[0]).toContain("db.index.vector.queryNodes");
    expect(semanticArgs[1]).toMatchObject({
      indexName: "account_chat_embedding",
      companyId: "co1",
      minScore: 0.6,
    });
  });

  it("returns matchMode='none' when even semantic tier yields nothing above the floor", async () => {
    const neo4j = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({ records: [] }),
    };
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };

    const svc = new ChatbotSearchService(neo4j as any, embedder as any, indexNames as any);
    const out = await svc.runCascadingSearch({ entity, text: "nonsense", companyId: "co1", limit: 5 });

    expect(out.matchMode).toBe("none");
    expect(out.items).toHaveLength(0);
  });
});
