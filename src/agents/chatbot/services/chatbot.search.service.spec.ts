import { vi, describe, it, expect } from "vitest";
import { ChatbotSearchService } from "./chatbot.search.service";

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

describe("ChatbotSearchService — tier Cypher projection", () => {
  it("tier 1 substring Cypher projects properties(node) alongside id and score", async () => {
    const neo4j = { read: vi.fn().mockResolvedValue({ records: [] }) };
    const embedder = { vectoriseText: vi.fn() };
    const svc = new ChatbotSearchService(neo4j as any, embedder as any, indexNames as any, catalog);
    await svc.resolveEntity({ text: "x", companyId: "co1", userModuleIds: ["11111111-1111-1111-1111-111111111111"] });

    const cypher = neo4j.read.mock.calls[0][0] as string;
    expect(cypher).toMatch(/properties\(node\)\s+AS\s+properties/);
    expect(cypher).toMatch(/node\.id\s+AS\s+id/);
    expect(cypher).toMatch(/\(node\)-\[:BELONGS_TO\]->\(:Company \{ id: \$companyId \}\)/);
  });

  it("tier 3 semantic Cypher projects properties(node) alongside id and score", async () => {
    const neo4j = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ records: [] }) // tier 1
        .mockResolvedValueOnce({ records: [] }) // tier 2
        .mockResolvedValueOnce({ records: [] }), // tier 3
    };
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };
    const svc = new ChatbotSearchService(neo4j as any, embedder as any, indexNames as any, catalog);
    await svc.resolveEntity({ text: "x", companyId: "co1", userModuleIds: ["11111111-1111-1111-1111-111111111111"] });

    const cypher = neo4j.read.mock.calls[2][0] as string;
    expect(cypher).toMatch(/properties\(node\)\s+AS\s+properties/);
    expect(cypher).toMatch(/\(node\)-\[:BELONGS_TO\]->\(:Company \{ id: \$companyId \}\)/);
  });

  it("tier 1 escapes Lucene reserved characters in the search term", async () => {
    const neo4j = { read: vi.fn().mockResolvedValue({ records: [] }) };
    const embedder = { vectoriseText: vi.fn().mockResolvedValue([0.1]) };

    const svc = new ChatbotSearchService(neo4j as any, embedder as any, indexNames as any, catalog);
    await svc.resolveEntity({ text: "Faby & Carlo", companyId: "co1", userModuleIds: ["11111111-1111-1111-1111-111111111111"] });

    const tier1Params = neo4j.read.mock.calls[0][1];
    expect(tier1Params.term).not.toMatch(/[^\\]&/);
    expect(tier1Params.term).toContain("\\&");
  });
});
