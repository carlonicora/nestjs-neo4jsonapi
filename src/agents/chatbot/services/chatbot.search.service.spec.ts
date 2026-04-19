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
        records: [{ get: (k: string) => ({ id: "a1", score: 12.3 } as any)[k] }],
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
